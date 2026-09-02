# Zero-dependency Local HTTP Web Server
$port = 8080
$folder = "d:\kiki"

$mimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".htm"  = "text/html; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".gif"  = "image/gif"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
    ".woff" = "font/woff"
    ".woff2"= "font/woff2"
    ".ttf"  = "font/ttf"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Prefixes.Add("http://127.0.0.1:$port/")

try {
    $listener.Start()
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host " 🚀 LOCAL SERVER RUNNING SUCCESSFULLY!" -ForegroundColor Cyan
    Write-Host " 👉 Open URL in browser: http://localhost:$port" -ForegroundColor Yellow
    Write-Host " 👉 Or: http://127.0.0.1:$port" -ForegroundColor Yellow
    Write-Host "==========================================================" -ForegroundColor Green
} catch {
    Write-Host "Failed to start listener: $_" -ForegroundColor Red
    exit 1
}

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $rawPath = $request.Url.LocalPath.TrimStart('/')
        if ([string]::IsNullOrWhiteSpace($rawPath) -or $rawPath -eq "") {
            $rawPath = "index.html"
        }

        # Remove query parameters from path
        $cleanPath = $rawPath.Split('?')[0]
        $filePath = Join-Path $folder $cleanPath

        # Add CORS and no-cache headers for dev
        $response.Headers.Add("Access-Control-Allow-Origin", "*")
        $response.Headers.Add("Cache-Control", "no-cache, no-store, must-revalidate")

        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $mime = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { "application/octet-stream" }
            $response.ContentType = $mime
            
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.StatusCode = 200
        } else {
            $response.StatusCode = 404
            $errBytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $rawPath")
            $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
        }
        $response.Close()
    } catch {
        # continue listening on error
    }
}