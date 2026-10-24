using System.Text.Json;
using Modulab.ControlCenter.Infrastructure;
using Modulab.ControlCenter.Models;

namespace Modulab.ControlCenter.Catalog;

/// <summary>Loads recipes from catalog/ (kit, overwritten on upgrade) and catalog.local/ (user-owned).</summary>
public sealed class RecipeStore(LabPaths paths, ILogger<RecipeStore> log)
{
    public List<Recipe> All()
    {
        var builtIn = LoadDir(paths.Catalog, custom: false);
        var ids = builtIn.Select(r => r.Id).ToHashSet(StringComparer.Ordinal);
        var list = new List<Recipe>(builtIn);
        foreach (var recipe in LoadDir(paths.LocalCatalog, custom: true))
        {
            // A local recipe may not shadow a built-in one — customise those with an override file instead.
            if (ids.Add(recipe.Id))
                list.Add(recipe);
            else
                log.LogWarning("catalog.local/{Id} ignored: id is used by a built-in app", recipe.Id);
        }
        return list;
    }

    public Recipe? Find(string id) => All().FirstOrDefault(r => r.Id == id);

    public string ResolveComposeFile(Recipe recipe)
    {
        if (!string.IsNullOrWhiteSpace(recipe.Compose))
        {
            var relative = recipe.Compose.Replace('/', Path.DirectorySeparatorChar)
                .Replace('\\', Path.DirectorySeparatorChar);
            return Path.GetFullPath(Path.Combine(paths.Root, relative));
        }

        return recipe.Custom
            ? Path.Combine(recipe.Directory, "docker-compose.yml")
            : Path.Combine(paths.Root, $"docker-compose.{recipe.Id}.yml");
    }

    List<Recipe> LoadDir(string dir, bool custom)
    {
        var list = new List<Recipe>();
        if (!System.IO.Directory.Exists(dir))
            return list;

        foreach (var path in System.IO.Directory.GetDirectories(dir).OrderBy(p => p, StringComparer.Ordinal))
        {
            var recipePath = Path.Combine(path, "recipe.json");
            if (!File.Exists(recipePath))
                continue;
            try
            {
                var recipe = JsonSerializer.Deserialize(File.ReadAllText(recipePath), LabJsonContext.Default.Recipe);
                if (recipe is null || string.IsNullOrWhiteSpace(recipe.Id))
                    continue;
                recipe.Custom = custom;
                recipe.Directory = path;
                list.Add(recipe);
            }
            catch (JsonException ex)
            {
                log.LogWarning("Skipping broken recipe {Path}: {Message}", recipePath, ex.Message);
            }
        }

        return list;
    }
}
