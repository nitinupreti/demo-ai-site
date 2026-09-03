Add-Type -AssemblyName System.Web
$b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("admin:admin"))
$H = @{ Authorization = "Basic $b64"; Referer = "http://localhost:4502/" }
$token = ((Invoke-WebRequest -Uri "http://localhost:4502/libs/granite/csrf/token.json" -Headers $H -UseBasicParsing).Content | ConvertFrom-Json).token
$H["CSRF-Token"] = $token
$xfRoot = "http://localhost:4502/content/experience-fragments/demo-ai-site/us/en/site/header/master/jcr:content/root"
$page = "/content/demo-ai-site/us/en/credera"

# 1. Delete the page-level site-header (structure-level, not page-level).
Invoke-WebRequest -Method POST -Uri "http://localhost:4502$page/_jcr_content/root/container/site-header" -Headers $H -Body @{ ':operation' = 'delete' } -UseBasicParsing -ErrorAction SilentlyContinue | Out-Null

# 2. Wipe stale children of the header XF root (site-header, navigation, languagenavigation, search).
foreach ($n in @('site-header','navigation','languagenavigation','search','logo')) {
    Invoke-WebRequest -Method POST -Uri "$xfRoot/$n" -Headers $H -Body @{ ':operation' = 'delete' } -UseBasicParsing -ErrorAction SilentlyContinue | Out-Null
}

# 3. Create fresh site-header node with brand + region.
Invoke-WebRequest -Method POST -Uri "$xfRoot/*" -Headers $H -UseBasicParsing -Body @{
    ':name' = 'site-header'
    'jcr:primaryType' = 'nt:unstructured'
    'sling:resourceType' = 'demo-ai-site/components/site-header'
    'brandLabel' = 'Credera Logo'
    'brandHref' = $page
    'regionLabel' = 'India'
} | Out-Null

$sh = "$xfRoot/site-header"
Invoke-WebRequest -Method POST -Uri "$sh/*" -Headers $H -UseBasicParsing -Body @{ ':name' = 'utility'; 'jcr:primaryType' = 'nt:unstructured' } | Out-Null
Invoke-WebRequest -Method POST -Uri "$sh/*" -Headers $H -UseBasicParsing -Body @{ ':name' = 'mainNav'; 'jcr:primaryType' = 'nt:unstructured' } | Out-Null

# 4. Utility items in source order.
$utility = @(
    @{ name='item0'; label='SEARCH';  href='#search';  icon='search'; ariaLabel='Search' },
    @{ name='item1'; label='CONTACT'; href=$page;      icon='none';   ariaLabel='Contact' }
)
foreach ($u in $utility) {
    Invoke-WebRequest -Method POST -Uri "$sh/utility/*" -Headers $H -UseBasicParsing -Body @{
        ':name' = $u.name
        ':order' = 'last'
        'jcr:primaryType' = 'nt:unstructured'
        'label' = $u.label
        'href' = $u.href
        'icon' = $u.icon
        'ariaLabel' = $u.ariaLabel
    } | Out-Null
}

# 5. Main nav items in source order.
$mainNav = @('OFFERINGS','INDUSTRIES','PARTNERSHIPS','INSIGHTS','CAREERS','ABOUT US')
for ($i = 0; $i -lt $mainNav.Count; $i++) {
    Invoke-WebRequest -Method POST -Uri "$sh/mainNav/*" -Headers $H -UseBasicParsing -Body @{
        ':name' = "item$i"
        ':order' = 'last'
        'jcr:primaryType' = 'nt:unstructured'
        'label' = $mainNav[$i]
        'href' = $page
    } | Out-Null
}

"DONE"
