Add-Type -AssemblyName System.Web
$b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("admin:admin"))
$H = @{ Authorization = "Basic $b64"; Referer = "http://localhost:4502/" }
$token = ((Invoke-WebRequest -Uri "http://localhost:4502/libs/granite/csrf/token.json" -Headers $H -UseBasicParsing).Content | ConvertFrom-Json).token
$H["CSRF-Token"] = $token
$parent = "http://localhost:4502/content/demo-ai-site/us/en/credera/_jcr_content/root/container/container"
$page = "/content/demo-ai-site/us/en/credera"

function Enc([string]$s) { return [System.Web.HttpUtility]::UrlEncode($s) }

# Build service-list body
$slProps = @(
    "jcr:primaryType=nt:unstructured"
    "sling:resourceType=" + (Enc "demo-ai-site/components/service-list")
    "services/jcr:primaryType=nt:unstructured"
)
$svc1Labels = @("MarTech","AdTech","Marketing operations","Personalization","Marketing analytics","Commerce","Content automation","Content supply chain")
$svc2Labels = @("Enterprise data","Digital products","Scaled delivery","AI strategy","Agentic workflows","Tech modernization","Service model innovation")
# item0
$slProps += "services/item0/jcr:primaryType=nt:unstructured"
$slProps += "services/item0/title=" + (Enc "Marketing & advertising enablement")
$slProps += "services/item0/linkPath=" + (Enc $page)
$slProps += "services/item0/links/jcr:primaryType=nt:unstructured"
for ($i=0; $i -lt $svc1Labels.Count; $i++) {
    $slProps += "services/item0/links/item$i/jcr:primaryType=nt:unstructured"
    $slProps += "services/item0/links/item$i/label=" + (Enc $svc1Labels[$i])
    $slProps += "services/item0/links/item$i/linkPath=" + (Enc $page)
}
# item1
$slProps += "services/item1/jcr:primaryType=nt:unstructured"
$slProps += "services/item1/title=" + (Enc "Technology & data excellence")
$slProps += "services/item1/linkPath=" + (Enc $page)
$slProps += "services/item1/links/jcr:primaryType=nt:unstructured"
for ($i=0; $i -lt $svc2Labels.Count; $i++) {
    $slProps += "services/item1/links/item$i/jcr:primaryType=nt:unstructured"
    $slProps += "services/item1/links/item$i/label=" + (Enc $svc2Labels[$i])
    $slProps += "services/item1/links/item$i/linkPath=" + (Enc $page)
}
$body = ($slProps -join "&")
$r = Invoke-WebRequest -Method POST -Uri "$parent/service-list" -Headers $H -Body $body -ContentType "application/x-www-form-urlencoded" -UseBasicParsing
Write-Host "service-list create:" $r.StatusCode

# featured-case-study
$fcsProps = @(
    "jcr:primaryType=nt:unstructured"
    "sling:resourceType=" + (Enc "demo-ai-site/components/featured-case-study")
    "eyebrow=" + (Enc "Meaningful Results")
    "heading=" + (Enc "Transforming information access and efficiency with AI for AstraZeneca")
    "category=" + (Enc "Pharmaceuticals / Artificial Intelligence")
    "posterAlt=" + (Enc "Video poster")
    "readOnLabel=" + (Enc "Read on")
    "linkPath=" + (Enc $page)
)
$body2 = ($fcsProps -join "&")
$r2 = Invoke-WebRequest -Method POST -Uri "$parent/featured-case-study" -Headers $H -Body $body2 -ContentType "application/x-www-form-urlencoded" -UseBasicParsing
Write-Host "featured-case-study create:" $r2.StatusCode

# reorder: service-list before marquee-ticker; marquee-ticker before featured-case-study
Invoke-WebRequest -Method POST -Uri "$parent/service-list" -Headers $H -Body @{ ':order' = 'before marquee-ticker' } -UseBasicParsing | Out-Null
Invoke-WebRequest -Method POST -Uri "$parent/marquee-ticker" -Headers $H -Body @{ ':order' = 'before featured-case-study' } -UseBasicParsing | Out-Null

# verify
$r3 = Invoke-WebRequest -Uri "$parent.1.json" -Headers $H -UseBasicParsing
($r3.Content | ConvertFrom-Json).PSObject.Properties | Where-Object { $_.MemberType -eq 'NoteProperty' -and $_.Value -is [PSCustomObject] } | ForEach-Object { $_.Name }
