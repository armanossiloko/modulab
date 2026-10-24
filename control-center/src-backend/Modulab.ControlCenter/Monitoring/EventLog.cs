using System.Text.Json;
using Modulab.ControlCenter.Infrastructure;
using Modulab.ControlCenter.Models;

namespace Modulab.ControlCenter.Monitoring;

/// <summary>
/// Recent lab events (app down/recovered, disk full, backup results). Kept in memory and appended to
/// data/control-center/events.jsonl so they survive a Control Center restart.
/// </summary>
public sealed class EventLog
{
    const int MaxEvents = 300;

    readonly Lock gate = new();
    readonly LinkedList<LabEvent> events = new();
    readonly string file;
    readonly Notifier notifier;
    readonly TimeProvider clock;

    public EventLog(LabPaths paths, Notifier notifier, TimeProvider clock)
    {
        this.notifier = notifier;
        this.clock = clock;
        file = Path.Combine(paths.State, "events.jsonl");
        LoadExisting();
    }

    void LoadExisting()
    {
        if (!File.Exists(file))
            return;
        try
        {
            var lines = File.ReadAllLines(file);
            foreach (var line in lines.TakeLast(MaxEvents))
            {
                if (JsonSerializer.Deserialize(line, LabJsonContext.Default.LabEvent) is { } e)
                    events.AddFirst(e);
            }
            // Compact the file so it never grows without bound.
            if (lines.Length > MaxEvents * 2)
                File.WriteAllLines(file, lines.TakeLast(MaxEvents));
        }
        catch (Exception ex) when (ex is IOException or JsonException)
        {
            // A damaged event log is not worth failing startup over.
        }
    }

    public List<LabEvent> Recent(int limit)
    {
        lock (gate)
            return events.Take(limit).ToList();
    }

    /// <summary>Record an event; <paramref name="notify"/> also pushes it to ntfy / webhook.</summary>
    public LabEvent Add(string level, string kind, string source, string message, bool notify)
    {
        var e = new LabEvent(Guid.NewGuid().ToString("n")[..12], clock.GetUtcNow(), level, kind, source, message);
        lock (gate)
        {
            events.AddFirst(e);
            while (events.Count > MaxEvents)
                events.RemoveLast();
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(file)!);
                File.AppendAllText(file, JsonSerializer.Serialize(e, LabJsonContext.Default.LabEvent) + "\n");
            }
            catch (IOException)
            {
                // In-memory copy is still available.
            }
        }

        if (notify)
            notifier.Enqueue(e);
        return e;
    }
}
