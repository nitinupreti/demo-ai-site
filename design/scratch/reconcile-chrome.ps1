$b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin'))
$h = @{ Authorization = "Basic $b64"; Referer = "http://localhost:4504/" }

function Get-Csrf {
    (Invoke-RestMethod -Uri "http://localhost:4504/libs/granite/csrf/token.json" -Headers $h).token
}

function Post-Multipart($path, [hashtable]$fields) {
    $token = Get-Csrf
    $headers = @{ Authorization = $h.Authorization; Referer = $h.Referer; "CSRF-Token" = $token }
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
    Invoke-WebRequest -Method Post -Uri "http://localhost:4504$path" -Headers $headers -ContentType "multipart/form-data; boundary=$boundary" -Body $body -UseBasicParsing
}

# ---- HEADER XF ----
$headerRoot = "/content/experience-fragments/demo-ai-site/us/en/site/header/master/jcr:content/root"

# Delete old children
foreach ($c in @("navigation","languagenavigation","search","logo","site-header")) {
    try { Post-Multipart "$headerRoot/$c" @{ ":operation"="delete" } | Out-Null } catch { }
}

# Create site-header node with properties
$fields = @{
    "jcr:primaryType" = "nt:unstructured"
    "sling:resourceType" = "demo-ai-site/components/site-header"
    "logoText" = "Notion"
    "logoHref" = "/content/demo-ai-site/us/en.html"
    "ctaLabel" = "Request a demo"
    "ctaHref" = "#request-a-demo"
    "secondaryLabel" = "Log in"
    "secondaryHref" = "#login"
}
Post-Multipart "$headerRoot/*" ($fields + @{ ":name" = "site-header" }) | Out-Null

# Nav items
$navItems = @(
    @{ label="Product";   href="#product" },
    @{ label="Templates"; href="#templates" },
    @{ label="Solutions"; href="#solutions" },
    @{ label="Docs";      href="#docs" },
    @{ label="Pricing";   href="#pricing" }
)
Post-Multipart "$headerRoot/site-header/*" @{ ":name" = "navItems"; "jcr:primaryType" = "nt:unstructured" } | Out-Null
for ($i=0; $i -lt $navItems.Count; $i++) {
    $n = "item$i"
    $body = @{
        ":name" = $n
        "jcr:primaryType" = "nt:unstructured"
        "label" = $navItems[$i].label
        "href"  = $navItems[$i].href
    }
    Post-Multipart "$headerRoot/site-header/navItems/*" $body | Out-Null
}

# ---- FOOTER XF ----
$footerRoot = "/content/experience-fragments/demo-ai-site/us/en/site/footer/master/jcr:content/root"

foreach ($c in @("separator","text","site-footer")) {
    try { Post-Multipart "$footerRoot/$c" @{ ":operation"="delete" } | Out-Null } catch { }
}

$ffields = @{
    "jcr:primaryType" = "nt:unstructured"
    "sling:resourceType" = "demo-ai-site/components/site-footer"
    "quoteText" = "We shape our tools, and thereafter our tools shape us."
    "quoteAttribution" = "Marshall McLuhan"
    "copyright" = "© 2026 Demo AI Site. All rights reserved."
}
Post-Multipart "$footerRoot/*" ($ffields + @{ ":name" = "site-footer" }) | Out-Null

$groups = @(
    @{ heading="Product";    links=@(@{label="Features";href="#features"},@{label="What's New";href="#whats-new"},@{label="Notion AI";href="#ai"},@{label="Pricing";href="#pricing"},@{label="Request a demo";href="#demo"},@{label="Download";href="#download"}) },
    @{ heading="Templates";  links=@(@{label="Browse templates";href="#browse"},@{label="Consultants";href="#consultants"},@{label="Connections";href="#connections"},@{label="Discover";href="#discover"},@{label="Customer stories";href="#stories"}) },
    @{ heading="Resources";  links=@(@{label="Help center";href="#help"},@{label="Community";href="#community"},@{label="Blog";href="#blog"},@{label="Guides";href="#guides"},@{label="API";href="#api"}) },
    @{ heading="Company";    links=@(@{label="About";href="#about"},@{label="Careers";href="#careers"},@{label="Security";href="#security"},@{label="Status";href="#status"},@{label="Terms";href="#terms"}) }
)
Post-Multipart "$footerRoot/site-footer/*" @{ ":name" = "linkGroups"; "jcr:primaryType" = "nt:unstructured" } | Out-Null
for ($i=0; $i -lt $groups.Count; $i++) {
    $gname = "g$i"
    Post-Multipart "$footerRoot/site-footer/linkGroups/*" @{
        ":name" = $gname
        "jcr:primaryType" = "nt:unstructured"
        "heading" = $groups[$i].heading
    } | Out-Null
    Post-Multipart "$footerRoot/site-footer/linkGroups/$gname/*" @{ ":name" = "links"; "jcr:primaryType" = "nt:unstructured" } | Out-Null
    for ($j=0; $j -lt $groups[$i].links.Count; $j++) {
        Post-Multipart "$footerRoot/site-footer/linkGroups/$gname/links/*" @{
            ":name" = "l$j"
            "jcr:primaryType" = "nt:unstructured"
            "label" = $groups[$i].links[$j].label
            "href"  = $groups[$i].links[$j].href
        } | Out-Null
    }
}
"reconcile complete"
