using System.Collections.Concurrent;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Modulab.ControlCenter.Infrastructure;
using Modulab.ControlCenter.Lab;

namespace Modulab.ControlCenter.Auth;

/// <summary>Persisted admin credential (data/control-center/auth.json).</summary>
public sealed class AuthFile
{
    public string PasswordHash { get; set; } = "";
    public string Salt { get; set; } = "";
    public int Iterations { get; set; }
    /// <summary>HMAC key for session cookies. Rotated on password change → signs out every session.</summary>
    public string SessionKey { get; set; } = "";
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>
/// Single-admin login for Control Center. Sessions are stateless HMAC-signed cookies
/// (no server session store, AOT-friendly, survive restarts).
/// </summary>
public sealed class AuthService(LabPaths paths, LabConfigStore config, TimeProvider clock)
{
    public const string CookieName = "modulab_session";
    public const string Username = "admin";
    public const int MinPasswordLength = 8;

    const int Iterations = 210_000;
    const int MaxFailures = 5;
    static readonly TimeSpan SessionLifetime = TimeSpan.FromHours(12);
    static readonly TimeSpan RememberLifetime = TimeSpan.FromDays(30);
    static readonly TimeSpan BaseLockout = TimeSpan.FromMinutes(1);
    static readonly TimeSpan MaxLockout = TimeSpan.FromMinutes(15);

    // Monitor (not System.Threading.Lock): Setup/ChangePassword re-enter through Read().
    readonly object gate = new();
    readonly ConcurrentDictionary<string, Attempts> attempts = new(StringComparer.Ordinal);
    AuthFile? cached;
    DateTime cachedStamp;

    string FilePath => Path.Combine(paths.State, "auth.json");

    sealed class Attempts
    {
        public int Failures;
        public DateTimeOffset LockedUntil;
    }

    public bool IsConfigured => Read() is { PasswordHash.Length: > 0 };

    AuthFile? Read()
    {
        lock (gate)
        {
            if (!File.Exists(FilePath))
            {
                cached = null;
                return null;
            }
            // Re-read when the file changes on disk (e.g. deleted to reset the password).
            var stamp = File.GetLastWriteTimeUtc(FilePath);
            if (cached is not null && stamp == cachedStamp)
                return cached;
            cached = JsonSerializer.Deserialize(File.ReadAllText(FilePath), LabJsonContext.Default.AuthFile);
            cachedStamp = stamp;
            return cached;
        }
    }

    void Write(AuthFile file)
    {
        lock (gate)
        {
            AtomicFile.WriteAllText(FilePath, JsonSerializer.Serialize(file, LabJsonContext.Default.AuthFile));
            cached = file;
            cachedStamp = File.GetLastWriteTimeUtc(FilePath);
        }
    }

    public static string? ValidatePassword(string? password)
    {
        if (string.IsNullOrEmpty(password) || password.Length < MinPasswordLength)
            return $"Password must be at least {MinPasswordLength} characters";
        if (password.Length > 256)
            return "Password is too long";
        return null;
    }

    /// <summary>First run: claim the instance. Fails once a password exists.</summary>
    public void Setup(string password)
    {
        lock (gate)
        {
            if (IsConfigured)
                throw new InvalidOperationException("Control Center already has an admin password");
            if (ValidatePassword(password) is { } error)
                throw new ArgumentException(error);
            Write(NewCredential(password));
        }
    }

    public bool ChangePassword(string current, string next)
    {
        lock (gate)
        {
            if (!VerifyPassword(current))
                return false;
            if (ValidatePassword(next) is { } error)
                throw new ArgumentException(error);
            Write(NewCredential(next));
            return true;
        }
    }

    /// <summary>Rotate the session key: every existing cookie stops working.</summary>
    public void SignOutEverywhere()
    {
        lock (gate)
        {
            var file = Read() ?? throw new InvalidOperationException("No admin password set");
            file.SessionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
            file.UpdatedAt = clock.GetUtcNow();
            Write(file);
        }
    }

    AuthFile NewCredential(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        return new AuthFile
        {
            Salt = Convert.ToBase64String(salt),
            Iterations = Iterations,
            PasswordHash = Convert.ToBase64String(Hash(password, salt, Iterations)),
            SessionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
            UpdatedAt = clock.GetUtcNow(),
        };
    }

    static byte[] Hash(string password, byte[] salt, int iterations) =>
        Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password), salt, iterations, HashAlgorithmName.SHA256, 32);

    public bool VerifyPassword(string? password)
    {
        var file = Read();
        if (file is null || string.IsNullOrEmpty(password))
            return false;
        var expected = Convert.FromBase64String(file.PasswordHash);
        var actual = Hash(password, Convert.FromBase64String(file.Salt), file.Iterations);
        return CryptographicOperations.FixedTimeEquals(expected, actual);
    }

    // ── Login throttling ────────────────────────────────────────────────────

    public TimeSpan? LockedOutFor(string client)
    {
        if (!attempts.TryGetValue(client, out var a))
            return null;
        var left = a.LockedUntil - clock.GetUtcNow();
        return left > TimeSpan.Zero ? left : null;
    }

    public void RecordFailure(string client)
    {
        var a = attempts.GetOrAdd(client, _ => new Attempts());
        lock (a)
        {
            a.Failures++;
            if (a.Failures >= MaxFailures)
            {
                // 1, 2, 4, 8 … minutes, capped.
                var factor = Math.Pow(2, Math.Min(a.Failures - MaxFailures, 4));
                var lockout = TimeSpan.FromTicks(Math.Min(BaseLockout.Ticks * (long)factor, MaxLockout.Ticks));
                a.LockedUntil = clock.GetUtcNow() + lockout;
            }
        }
    }

    public void RecordSuccess(string client) => attempts.TryRemove(client, out _);

    /// <summary>Client key for throttling; trusts X-Forwarded-For only from a local reverse proxy.</summary>
    public static string ClientKey(HttpContext ctx)
    {
        var remote = ctx.Connection.RemoteIpAddress;
        if (remote is not null && IsLocalProxy(remote)
            && ctx.Request.Headers["X-Forwarded-For"].ToString() is { Length: > 0 } fwd)
            return fwd.Split(',')[0].Trim();
        return remote?.ToString() ?? "unknown";
    }

    static bool IsLocalProxy(IPAddress ip)
    {
        if (IPAddress.IsLoopback(ip))
            return true;
        if (ip.IsIPv4MappedToIPv6)
            ip = ip.MapToIPv4();
        var b = ip.GetAddressBytes();
        // Docker bridge networks (172.16/12) — Caddy on Docker Desktop reaches us from there.
        return b.Length == 4 && b[0] == 172 && b[1] >= 16 && b[1] <= 31;
    }

    // ── Session tokens ──────────────────────────────────────────────────────

    public string IssueToken(bool remember)
    {
        var file = Read() ?? throw new InvalidOperationException("No admin password set");
        var exp = (clock.GetUtcNow() + (remember ? RememberLifetime : SessionLifetime)).ToUnixTimeSeconds();
        var nonce = Base64Url(RandomNumberGenerator.GetBytes(12));
        var payload = $"v1.{exp}.{nonce}";
        return $"{payload}.{Sign(payload, file.SessionKey)}";
    }

    public bool ValidateToken(string? token)
    {
        if (string.IsNullOrEmpty(token))
            return false;
        var file = Read();
        if (file is null)
            return false;
        var parts = token.Split('.');
        if (parts.Length != 4 || parts[0] != "v1" || !long.TryParse(parts[1], out var exp))
            return false;
        if (DateTimeOffset.FromUnixTimeSeconds(exp) <= clock.GetUtcNow())
            return false;
        var expected = Encoding.ASCII.GetBytes(Sign($"{parts[0]}.{parts[1]}.{parts[2]}", file.SessionKey));
        var actual = Encoding.ASCII.GetBytes(parts[3]);
        return CryptographicOperations.FixedTimeEquals(expected, actual);
    }

    static string Sign(string payload, string key)
    {
        var mac = HMACSHA256.HashData(Convert.FromBase64String(key), Encoding.UTF8.GetBytes(payload));
        return Base64Url(mac);
    }

    static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public bool IsAuthenticated(HttpContext ctx) => ValidateToken(ctx.Request.Cookies[CookieName]);

    // ── Cookies ─────────────────────────────────────────────────────────────

    public static bool IsHttps(HttpRequest req) =>
        req.IsHttps
        || (string.Equals(req.Headers["X-Forwarded-Proto"], "https", StringComparison.OrdinalIgnoreCase)
            && req.HttpContext.Connection.RemoteIpAddress is { } ip && IsLocalProxy(ip));

    public string LabDomain() => LabConfigStore.GetString(config.Lab(config.Load()), "domain") ?? "network.lan";

    /// <summary>
    /// When signed in through a lab hostname (home.network.lan) the cookie is scoped to the whole lab
    /// domain, so Caddy's forward_auth sees it on protected app hostnames too.
    /// </summary>
    public CookieOptions CookieOptions(HttpRequest req, DateTimeOffset? expires)
    {
        var options = new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Lax,
            Secure = IsHttps(req),
            Path = "/",
            Expires = expires,
            IsEssential = true,
        };
        var domain = LabDomain();
        var host = req.Host.Host;
        if (!string.IsNullOrEmpty(domain) && host.EndsWith("." + domain, StringComparison.OrdinalIgnoreCase))
            options.Domain = domain;
        return options;
    }

    public void SignIn(HttpContext ctx, bool remember)
    {
        var token = IssueToken(remember);
        DateTimeOffset? expires = remember ? clock.GetUtcNow() + RememberLifetime : null;
        ctx.Response.Cookies.Append(CookieName, token, CookieOptions(ctx.Request, expires));
    }

    public void SignOut(HttpContext ctx) =>
        ctx.Response.Cookies.Delete(CookieName, CookieOptions(ctx.Request, null));

    /// <summary>Where forward_auth sends unauthenticated visitors: the Control Center login on home.&lt;domain&gt;.</summary>
    public string LoginRedirect(HttpRequest req)
    {
        var proto = req.Headers["X-Forwarded-Proto"].ToString() is { Length: > 0 } p ? p : "http";
        var host = req.Headers["X-Forwarded-Host"].ToString();
        var uri = req.Headers["X-Forwarded-Uri"].ToString();
        var domain = LabDomain();
        var target = string.IsNullOrEmpty(host) ? "" : $"{proto}://{host}{uri}";
        var login = $"{proto}://home.{domain}/login";
        return string.IsNullOrEmpty(target) ? login : $"{login}?rd={Uri.EscapeDataString(target)}";
    }
}
