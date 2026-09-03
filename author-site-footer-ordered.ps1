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

# 1. site-footer
Invoke-WebRequest -Method POST -Uri "$root/*" -Headers $H -UseBasicParsing -Body @{
    ':name' = 'site-footer'
    'jcr:primaryType' = 'nt:unstructured'
    'sling:resourceType' = 'demo-ai-site/components/site-footer'
    'brandLabel' = 'Credera Logo'
    'brandHref' = $page
    'brandBlurb' = $blurb
    'copyright' = $copyright
} | Out-Null

$sf = "$root/site-footer"
Invoke-WebRequest -Method POST -Uri "$sf/*" -Headers $H -UseBasicParsing -Body @{':name'='columns';'jcr:primaryType'='nt:unstructured'} | Out-Null
Invoke-WebRequest -Method POST -Uri "$sf/*" -Headers $H -UseBasicParsing -Body @{':name'='socials';'jcr:primaryType'='nt:unstructured'} | Out-Null

$columns = @(
    @{ name='item0'; heading='Explore'; items = @(
        @{ name='item0'; label='Industries' },
        @{ name='item1'; label='Partners' },
        @{ name='item2'; label='Insights' }
    ) },
    @{ name='item1'; heading='About Us'; items = @(
        @{ name='item0'; label='Leadership' },
        @{ name='item1'; label='Careers' },
        @{ name='item2'; label='Contact Us' }
    ) },
    @{ name='item2'; heading='Legal'; items = @(
        @{ name='item0'; label='Europe | Asia-Pacific Privacy Notice' },
        @{ name='item1'; label='Cookie Settings' }
    ) }
)
foreach ($col in $columns) {
    Invoke-WebRequest -Method POST -Uri "$sf/columns/*" -Headers $H -UseBasicParsing -Body @{
        ':name' = $col.name
        ':order' = 'last'
        'jcr:primaryType' = 'nt:unstructured'
        'heading' = $col.heading
    } | Out-Null
    Invoke-WebRequest -Method POST -Uri "$sf/columns/$($col.name)/*" -Headers $H -UseBasicParsing -Body @{':name'='links';'jcr:primaryType'='nt:unstructured'} | Out-Null
    foreach ($item in $col.items) {
        Invoke-WebRequest -Method POST -Uri "$sf/columns/$($col.name)/links/*" -Headers $H -UseBasicParsing -Body @{
            ':name' = $item.name
            ':order' = 'last'
            'jcr:primaryType' = 'nt:unstructured'
            'label' = $item.label
            'linkPath' = $page
        } | Out-Null
    }
}

$socials = @(
    @{ name='item0'; label='LinkedIn';  icon='linkedin';  href='https://www.linkedin.com/company/credera' },
    @{ name='item1'; label='Instagram'; icon='instagram'; href='https://www.instagram.com/lifeatcredera/' },
    @{ name='item2'; label='YouTube';   icon='youtube';   href='https://www.youtube.com/@CrederaVideo' }
)
foreach ($s in $socials) {
    Invoke-WebRequest -Method POST -Uri "$sf/socials/*" -Headers $H -UseBasicParsing -Body @{
        ':name' = $s.name
        ':order' = 'last'
        'jcr:primaryType' = 'nt:unstructured'
        'label' = $s.label
        'icon' = $s.icon
        'href' = $s.href
    } | Out-Null
}

"DONE"
