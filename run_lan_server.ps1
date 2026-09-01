param (
    [int]$Port = 5500
)

$root = "d:\kiki"
$dataDir = "d:\kiki\data"
if (!(Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }
$dbPath = Join-Path $dataDir "local_db.json"

if (!(Test-Path $dbPath)) {
    $initialDb = @{
        courses = @()
        exams = @()
        questions = @()
        students = @()
        submissions = @()
        results = @()
        teachers = @()
    }
    $initialDb | ConvertTo-Json -Depth 10 | Set-Content -Path $dbPath -Encoding UTF8
}

$ipAny = [System.Net.IPAddress]::Any
$server = New-Object System.Net.Sockets.TcpListener($ipAny, $Port)
$server.Start()

$myIps = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet' -and $_.IPAddress -notmatch '^169\.' } | Select-Object -ExpandProperty IPAddress

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ">>> KKWIND Offline LAN Exam Server is RUNNING <<<" -ForegroundColor Green
Write-Host ("Teacher (This PC): http://localhost:" + $Port + "/") -ForegroundColor Yellow
if ($myIps) {
    foreach ($ip in $myIps) {
        Write-Host ("Students (Wi-Fi/LAN): http://" + $ip + ":" + $Port + "/") -ForegroundColor Magenta
    }
}
Write-Host ("Serving Folder: " + $root) -ForegroundColor Gray
Write-Host "================================================================" -ForegroundColor Cyan

function Get-MimeType($filePath) {
    $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
    switch ($ext) {
        ".html" { return "text/html; charset=utf-8" }
        ".js"   { return "application/javascript; charset=utf-8" }
        ".css"  { return "text/css; charset=utf-8" }
        ".json" { return "application/json; charset=utf-8" }
        ".png"  { return "image/png" }
        ".jpg"  { return "image/jpeg" }
        ".jpeg" { return "image/jpeg" }
        ".svg"  { return "image/svg+xml" }
        ".ico"  { return "image/x-icon" }
        ".xlsx" { return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
        default { return "application/octet-stream" }
    }
}

while ($true) {
    try {
        $client = $server.AcceptTcpClient()
        $stream = $client.GetStream()
        $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
        $writer = New-Object System.IO.BinaryWriter($stream)

        $requestLine = $reader.ReadLine()
        if ([string]::IsNullOrWhiteSpace($requestLine)) {
            $client.Close()
            continue
        }

        $parts = $requestLine.Split(" ")
        $method = $parts[0]
        $rawUrl = $parts[1]

        $contentLength = 0
        while (($headerLine = $reader.ReadLine()) -and $headerLine.Trim().Length -gt 0) {
            if ($headerLine -match '^Content-Length:\s*(\d+)') {
                $contentLength = [int]$matches[1]
            }
        }

        $body = ""
        if ($contentLength -gt 0) {
            $buffer = New-Object char[] $contentLength
            $read = 0
            while ($read -lt $contentLength) {
                $n = $reader.Read($buffer, $read, $contentLength - $read)
                if ($n -le 0) { break }
                $read += $n
            }
            $body = New-Object string ($buffer, 0, $read)
        }

        $cleanPath = $rawUrl.Split("?")[0]

        if ($cleanPath -eq "/api/db") {
            if ($method -eq "OPTIONS") {
                $corsHeaders = "HTTP/1.1 200 OK`r`nAccess-Control-Allow-Origin: *`r`nAccess-Control-Allow-Methods: GET, POST, OPTIONS`r`nAccess-Control-Allow-Headers: Content-Type`r`nContent-Length: 0`r`n`r`n"
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($corsHeaders)
                $writer.Write($bytes)
            }
            elseif ($method -eq "GET") {
                $jsonContent = [System.IO.File]::ReadAllText($dbPath, [System.Text.Encoding]::UTF8)
                $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($jsonContent)
                $header = "HTTP/1.1 200 OK`r`nContent-Type: application/json; charset=utf-8`r`nAccess-Control-Allow-Origin: *`r`nContent-Length: " + $bodyBytes.Length + "`r`nConnection: close`r`n`r`n"
                $writer.Write([System.Text.Encoding]::UTF8.GetBytes($header))
                $writer.Write($bodyBytes)
            }
            elseif ($method -eq "POST") {
                if ($body.Length -gt 0) {
                    [System.IO.File]::WriteAllText($dbPath, $body, [System.Text.Encoding]::UTF8)
                }
                $okJson = '{"success":true}'
                $resBody = [System.Text.Encoding]::UTF8.GetBytes($okJson)
                $header = "HTTP/1.1 200 OK`r`nContent-Type: application/json; charset=utf-8`r`nAccess-Control-Allow-Origin: *`r`nContent-Length: " + $resBody.Length + "`r`nConnection: close`r`n`r`n"
                $writer.Write([System.Text.Encoding]::UTF8.GetBytes($header))
                $writer.Write($resBody)
            }
        }
        else {
            if ($cleanPath -eq "/" -or [string]::IsNullOrEmpty($cleanPath)) {
                $cleanPath = "/index.html"
            }
            $cleanRel = $cleanPath.TrimStart("/").Replace("/", "\")
            $localFilePath = Join-Path $root $cleanRel

            if (Test-Path $localFilePath -PathType Leaf) {
                $fileBytes = [System.IO.File]::ReadAllBytes($localFilePath)
                $mime = Get-MimeType $localFilePath
                $header = "HTTP/1.1 200 OK`r`nContent-Type: " + $mime + "`r`nAccess-Control-Allow-Origin: *`r`nContent-Length: " + $fileBytes.Length + "`r`nConnection: close`r`n`r`n"
                $writer.Write([System.Text.Encoding]::UTF8.GetBytes($header))
                $writer.Write($fileBytes)
            } else {
                $errBytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
                $header = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain`r`nContent-Length: " + $errBytes.Length + "`r`nConnection: close`r`n`r`n"
                $writer.Write([System.Text.Encoding]::UTF8.GetBytes($header))
                $writer.Write($errBytes)
            }
        }

        $writer.Flush()
        $client.Close()
    }
    catch {
        # continue loop on client abort
    }
}
