$b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin'))
$h = @{ Authorization = "Basic $b64"; Referer = "http://localhost:4504/" }
function Get-Csrf { (Invoke-RestMethod -Uri "http://localhost:4504/libs/granite/csrf/token.json" -Headers $h).token }

function Post-Fields($path, [hashtable]$fields) {
    $token = Get-Csrf
    $hdr = $h + @{ "CSRF-Token" = $token }
    $boundary = [Guid]::NewGuid().ToString('N')
    $LF = "`r`n"
    $sb = New-Object System.Text.StringBuilder
    foreach ($k in $fields.Keys) {
        [void]$sb.Append("--$boundary$LF")
        [void]$sb.Append("Content-Disposition: form-data; name=`"$k`"$LF$LF")
        [void]$sb.Append([string]$fields[$k])
        [void]$sb.Append($LF)
    }
    [void]$sb.Append("--$boundary--$LF")
    $body = [System.Text.Encoding]::UTF8.GetBytes($sb.ToString())
    Invoke-WebRequest -Method Post -Uri "http://localhost:4504$path" -Headers $hdr -ContentType "multipart/form-data; boundary=$boundary" -Body $body -UseBasicParsing
}

$plan = Get-Content "C:\projects\Trainings\new\demo-ai-site\design\scratch\page-plan.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$C = $plan.container

try {
    $existing = Invoke-RestMethod -Uri "http://localhost:4504$C.1.json" -Headers $h
    foreach ($p in $existing.PSObject.Properties) {
        if ($p.Value -is [System.Management.Automation.PSCustomObject] -and $p.Value.'jcr:primaryType') {
            Post-Fields "$C/$($p.Name)" @{ ":operation" = "delete" } | Out-Null
        }
    }
    "cleared inner container children"
} catch { "clear FAIL $($_.Exception.Message)" }

foreach ($item in $plan.order) {
    $fields = @{
        ":name" = $item.name
        "jcr:primaryType" = "nt:unstructured"
        "sling:resourceType" = $item.resourceType
    }
    foreach ($p in $item.fields.PSObject.Properties) { $fields[$p.Name] = $p.Value }
    Post-Fields "$C/*" $fields | Out-Null
    Write-Host "$($item.name): created"
}

$grid = "$C/related-case-studies"
Post-Fields "$grid/*" @{ ":name" = "items"; "jcr:primaryType" = "nt:unstructured" } | Out-Null
foreach ($t in $plan.caseStudyTiles) {
    $fields = @{
        ":name" = $t.name
        "jcr:primaryType" = "nt:unstructured"
        eyebrow = $t.eyebrow
        title = $t.title
        href = $t.href
        thumbnail = $t.thumbnail
        thumbnailAlt = $t.thumbnailAlt
    }
    Post-Fields "$grid/items/*" $fields | Out-Null
    Write-Host "tile $($t.name): created"
}

foreach ($item in $plan.order) {
    Post-Fields "$C/$($item.name)" @{ ":order" = "last" } | Out-Null
}

Write-Host "reconcile complete"
