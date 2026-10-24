using System.Text.Json;
using System.Text.Json.Serialization;

namespace Modulab.ControlCenter.Models;

/// <summary>catalog/&lt;id&gt;/recipe.json (or catalog.local/&lt;id&gt;/recipe.json).</summary>
public sealed class Recipe
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string Category { get; set; } = "other";
    public string Compose { get; set; } = "";
    public string EnvFile { get; set; } = "";
    public int? Port { get; set; }
    public string? Path { get; set; }
    public bool Installable { get; set; } = true;
    public bool Core { get; set; }
    public List<string> DependsOn { get; set; } = [];
    public List<string> PreferShared { get; set; } = [];
    public string? Database { get; set; }
    public bool DatabaseNeedsVector { get; set; }
    public Dictionary<string, JsonElement> Defaults { get; set; } = new();
    public List<RecipeField> Fields { get; set; } = [];
    public RecipeProxy? Proxy { get; set; }
    public List<string> Dns { get; set; } = [];

    /// <summary>Lab-relative directories owned by this app (backed up, deleted on purge).</summary>
    public List<string> Data { get; set; } = [];

    public RecipeBackup? Backup { get; set; }

    /// <summary>Set when loaded from catalog.local/ (not serialized back to recipe.json).</summary>
    [JsonIgnore]
    public bool Custom { get; set; }

    /// <summary>Directory the recipe was loaded from.</summary>
    [JsonIgnore]
    public string Directory { get; set; } = "";
}

public sealed class RecipeProxy
{
    public string? Host { get; set; }
    public int? Port { get; set; }
}

public sealed class RecipeBackup
{
    /// <summary>Paths under <see cref="Recipe.Data"/> that are not worth copying (caches, transcodes).</summary>
    public List<string> Exclude { get; set; } = [];

    /// <summary>Stop the app while copying files (SQLite databases are not safe to copy live).</summary>
    public bool Stop { get; set; }
}

public sealed class RecipeField
{
    public string Key { get; set; } = "";
    public string Label { get; set; } = "";
    public string Type { get; set; } = "string";
    public bool Required { get; set; }
    public string? FromLab { get; set; }
    public JsonElement? Default { get; set; }
}
