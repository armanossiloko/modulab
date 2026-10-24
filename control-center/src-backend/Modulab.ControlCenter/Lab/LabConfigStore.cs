using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Modulab.ControlCenter.Infrastructure;

namespace Modulab.ControlCenter.Lab;

/// <summary>Reads and writes lab.config.json — the only hand-edited lab file.</summary>
public sealed class LabConfigStore(LabPaths paths)
{
    /// <summary>Placeholder in lab.config.example.json, replaced by a random secret on first use.</summary>
    public const string GeneratePlaceholder = "$generate";

    /// <summary>Lab secrets that ship with an insecure default and should be rotated.</summary>
    public static readonly string[] SecretKeys =
    [
        "postgresPassword",
        "piholePassword",
        "picoshareAdminSecret",
        "futoNotesPassword",
        "searxngSecret",
        "mediacmsAdminPassword",
    ];

    const string LegacyDefaultSecret = "modulab";
    static readonly JsonSerializerOptions Indented = new() { WriteIndented = true };
    // Monitor (not System.Threading.Lock) because Update → Load re-enters on the same thread.
    readonly object gate = new();

    public JsonObject Load()
    {
        lock (gate)
        {
            if (!File.Exists(paths.Config))
                CreateFromExample();

            return JsonNode.Parse(File.ReadAllText(paths.Config)) as JsonObject
                ?? throw new InvalidOperationException("lab.config.json must be an object");
        }
    }

    public void Save(JsonObject config)
    {
        lock (gate)
        {
            AtomicFile.WriteAllText(paths.Config, config.ToJsonString(Indented) + "\n");
        }
    }

    /// <summary>Load, mutate, save under one lock so concurrent requests do not drop each other's edits.</summary>
    public void Update(Action<JsonObject> mutate)
    {
        lock (gate)
        {
            var config = Load();
            mutate(config);
            Save(config);
        }
    }

    public JsonObject Lab(JsonObject config)
    {
        if (config["lab"] is not JsonObject lab)
        {
            lab = new JsonObject();
            config["lab"] = lab;
        }
        return lab;
    }

    public HashSet<string> Enabled()
    {
        var set = new HashSet<string>(StringComparer.Ordinal);
        if (!File.Exists(paths.Config))
            return set;
        try
        {
            if (Load()["enabled"] is JsonArray arr)
            {
                foreach (var item in arr)
                {
                    if (item is JsonValue v && v.TryGetValue<string>(out var id) && !string.IsNullOrWhiteSpace(id))
                        set.Add(id);
                }
            }
        }
        catch (JsonException)
        {
            // Corrupt config: treat as nothing enabled rather than failing every request.
        }
        return set;
    }

    public void Enable(string id) => Update(config => SetEnabled(config, id, true));

    public void Disable(string id) => Update(config => SetEnabled(config, id, false));

    public static void SetEnabled(JsonObject config, string id, bool on)
    {
        if (config["enabled"] is not JsonArray enabled)
        {
            enabled = [];
            config["enabled"] = enabled;
        }

        var index = -1;
        for (var i = 0; i < enabled.Count; i++)
        {
            if (enabled[i] is JsonValue v && v.TryGetValue<string>(out var s) && s == id)
            {
                index = i;
                break;
            }
        }

        if (on && index < 0)
            // Non-generic JsonValue.Create: JsonArray.Add<T> is not trim/AOT-safe.
            enabled.Add((JsonNode)JsonValue.Create(id));
        else if (!on)
        {
            for (var i = enabled.Count - 1; i >= 0; i--)
            {
                if (enabled[i] is JsonValue v && v.TryGetValue<string>(out var s) && s == id)
                    enabled.RemoveAt(i);
            }
        }
    }

    public static string? GetString(JsonObject obj, string key) =>
        obj[key] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    public static bool GetBool(JsonObject obj, string key, bool fallback = false)
    {
        if (obj[key] is not JsonValue v)
            return fallback;
        if (v.TryGetValue<bool>(out var b))
            return b;
        return v.TryGetValue<string>(out var s)
            ? string.Equals(s, "true", StringComparison.OrdinalIgnoreCase)
            : fallback;
    }

    public static List<string> GetStringList(JsonObject obj, string key)
    {
        var list = new List<string>();
        if (obj[key] is JsonArray arr)
        {
            foreach (var item in arr)
            {
                if (item is JsonValue v && v.TryGetValue<string>(out var s) && !string.IsNullOrWhiteSpace(s))
                    list.Add(s);
            }
        }
        return list;
    }

    public static bool IsPlaceholderHostIp(string? hostIp)
    {
        if (string.IsNullOrWhiteSpace(hostIp))
            return true;
        return hostIp.Trim() is "127.0.0.1" or "localhost" or "192.168.1.10" or "0.0.0.0";
    }

    public bool IsReady() => !IsPlaceholderHostIp(GetString(Lab(Load()), "hostIp"));

    /// <summary>Secrets still set to the old shared default (installs from before random secrets).</summary>
    public List<string> WeakSecrets()
    {
        var lab = Lab(Load());
        return SecretKeys
            .Where(key => GetString(lab, key) == LegacyDefaultSecret)
            .ToList();
    }

    /// <summary>Replace every "$generate" placeholder in the lab section. Returns true when anything changed.</summary>
    public static bool ResolveGeneratedSecrets(JsonObject config)
    {
        if (config["lab"] is not JsonObject lab)
            return false;
        var changed = false;
        foreach (var (key, value) in lab.ToList())
        {
            if (value is JsonValue v && v.TryGetValue<string>(out var s) && s == GeneratePlaceholder)
            {
                lab[key] = NewSecret();
                changed = true;
            }
        }
        return changed;
    }

    /// <summary>URL-safe random secret (no characters that need quoting in .env or URLs).</summary>
    public static string NewSecret(int bytes = 18) =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(bytes))
            .Replace('+', 'x')
            .Replace('/', 'y')
            .TrimEnd('=');

    void CreateFromExample()
    {
        JsonObject config;
        if (File.Exists(paths.ExampleConfig)
            && JsonNode.Parse(File.ReadAllText(paths.ExampleConfig)) is JsonObject example)
            config = example;
        else
            config = JsonNode.Parse(
                """{"lab":{},"caddy":{"ENABLE_LAN_PROXY":true},"enabled":["control-center","postgres","caddy"]}""")!
                .AsObject();

        ResolveGeneratedSecrets(config);
        Directory.CreateDirectory(Path.GetDirectoryName(paths.Config)!);
        AtomicFile.WriteAllText(paths.Config, config.ToJsonString(Indented) + "\n");
    }
}
