namespace Modulab.ControlCenter.Infrastructure;

public static class AtomicFile
{
    /// <summary>Write via a temp file + rename so a crash never leaves a half-written config.</summary>
    public static void WriteAllText(string path, string contents)
    {
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir))
            Directory.CreateDirectory(dir);
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, contents);
        File.Move(tmp, path, overwrite: true);
    }
}
