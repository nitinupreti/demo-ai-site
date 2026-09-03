Add-Type -AssemblyName System.Web
$b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("admin:admin"))
$H = @{ Authorization = "Basic $b64"; Referer = "http://localhost:4502/" }
$token = ((Invoke-WebRequest -Uri "http://localhost:4502/libs/granite/csrf/token.json" -Headers $H -UseBasicParsing).Content | ConvertFrom-Json).token
$H["CSRF-Token"] = $token
$root = "http://localhost:4502/content/experience-fragments/demo-ai-site/us/en/site/footer/master/jcr:content/root"

Invoke-WebRequest -Method POST -Uri "$root/site-footer" -Headers $H -Body @{ ':operation' = 'delete' } -UseBasicParsing -ErrorAction SilentlyContinue | Out-Null

$blurb = "Credera empowers the world" + [char]0x2019 + "s leading brands to navigate the complexities of data, technology, and marketing. As the global consultancy embedded within Omnicom" + [char]0x2019 + "s creative and media scale, we bridge marketing ambition and technical execution to accelerate growth and build transformations that last."
$copyright = "Copyright " + [char]0x00A9 + " 2026 Credera. All rights reserved."
$page = "/content/demo-ai-site/us/en/credera"

$body = @{
    ':name' = 'site-footer'
    'jcr:primaryType' = 'nt:unstructured'
    'sling:resourceType' = 'demo-ai-site/components/site-footer'
    'brandLabel' = 'Credera Logo'
    'brandHref' = $page
    'brandBlurb' = $blurb
    'copyright' = $copyright
    'columns/jcr:primaryType' = 'nt:unstructured'
    'socials/jcr:primaryType' = 'nt:unstructured'
}

$columns = @(
    @{ heading = "Explore"; items = @("Industries","Partners","Insights") },
    @{ heading = "About Us"; items = @("Leadership","Careers","Contact Us") },
    @{ heading = "Legal"; items = @("Europe | Asia-Pacific Privacy Notice","Cookie Settings") }
)
for ($c = 0; $c -lt $columns.Count; $c++) {
    $col = $columns[$c]
    $body["columns/item$c/jcr:primaryType"] = 'nt:unstructured'
    $body["columns/item$c/heading"] = $col.heading
    $body["columns/item$c/links/jcr:primaryType"] = 'nt:unstructured'
    for ($i = 0; $i -lt $col.items.Count; $i++) {
        $body["columns/item$c/links/item$i/jcr:primaryType"] = 'nt:unstructured'
        $body["columns/item$c/links/item$i/label"] = $col.items[$i]
        $body["columns/item$c/links/item$i/linkPath"] = $page
    }
}

$socials = @(
    @{ label="LinkedIn"; icon="linkedin"; href="https://www.linkedin.com/company/credera" },
    @{ label="Instagram"; icon="instagram"; href="https://www.instagram.com/lifeatcredera/" },
    @{ label="YouTube"; icon="youtube"; href="https://www.youtube.com/@CrederaVideo" }
)
for ($s = 0; $s -lt $socials.Count; $s++) {
    $body["socials/item$s/jcr:primaryType"] = 'nt:unstructured'
    $body["socials/item$s/label"] = $socials[$s].label
    $body["socials/item$s/icon"] = $socials[$s].icon
    $body["socials/item$s/href"] = $socials[$s].href
}

$r = Invoke-WebRequest -Method POST -Uri "$root/*" -Headers $H -Body $body -UseBasicParsing
"status=" + $r.StatusCode
