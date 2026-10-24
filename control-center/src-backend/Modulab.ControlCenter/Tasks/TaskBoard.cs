using Modulab.ControlCenter.Models;

namespace Modulab.ControlCenter.Tasks;

/// <summary>
/// The one long-running lab task (update, backup, restore, rollback) and its streamed output.
/// Only one runs at a time so two compose operations never race on the same stacks.
/// </summary>
public sealed class TaskBoard(ILogger<TaskBoard> log)
{
    const int MaxLines = 80;
    const int MaxLineLength = 240;

    readonly Lock gate = new();
    TaskRun? current;

    public AppTaskDto? Snapshot()
    {
        lock (gate)
            return current?.ToDto();
    }

    public bool IsRunning
    {
        get
        {
            lock (gate)
                return current?.Status == "running";
        }
    }

    public bool TryBegin(string id, string name, string action, out AppTaskDto snapshot, out TaskRun? run)
    {
        lock (gate)
        {
            if (current?.Status == "running")
            {
                snapshot = current.ToDto();
                run = null;
                return false;
            }

            run = new TaskRun(id, name, action);
            current = run;
            snapshot = run.ToDto();
            return true;
        }
    }

    public bool TryDismiss()
    {
        lock (gate)
        {
            if (current?.Status == "running")
                return false;
            current = null;
            return true;
        }
    }

    /// <summary>
    /// Start <paramref name="work"/> in the background. Returns false (with the running task) when busy.
    /// </summary>
    public bool TryStart(
        string id,
        string name,
        string action,
        string startMessage,
        Func<TaskRun, Task<string>> work,
        out AppTaskDto snapshot,
        string failureTitle = "Task failed")
    {
        if (!TryBegin(id, name, action, out snapshot, out var run))
            return false;

        run!.Note(startMessage);
        _ = Task.Run(async () =>
        {
            try
            {
                var done = await work(run);
                run.Finish("ok", done);
            }
            catch (Exception ex)
            {
                log.LogWarning("{Action} {Id} failed: {Message}", action, id, ex.Message);
                var message = ex.Message.Trim();
                if (message.Length > 500)
                    message = message[^500..];
                run.Finish("error", failureTitle, string.IsNullOrWhiteSpace(message) ? failureTitle : message);
            }
        });
        return true;
    }

    public sealed class TaskRun(string id, string name, string action)
    {
        readonly Lock gate = new();
        readonly List<string> lines = [];
        string status = "running";
        string latest = "Starting…";
        string? error;
        readonly DateTimeOffset startedAt = DateTimeOffset.UtcNow;

        public string Status
        {
            get
            {
                lock (gate)
                    return status;
            }
        }

        public void Note(string line)
        {
            var text = line.Trim();
            if (text.Length == 0)
                return;
            if (text.Length > MaxLineLength)
                text = text[..MaxLineLength];
            lock (gate)
            {
                latest = text;
                lines.Add(text);
                if (lines.Count > MaxLines)
                    lines.RemoveAt(0);
            }
        }

        public void Finish(string finalStatus, string finalLatest, string? finalError = null)
        {
            lock (gate)
            {
                status = finalStatus;
                latest = finalLatest;
                error = finalError;
            }
        }

        public AppTaskDto ToDto()
        {
            lock (gate)
                return new AppTaskDto(id, name, action, status, latest, lines.ToArray(), error, startedAt);
        }
    }
}
