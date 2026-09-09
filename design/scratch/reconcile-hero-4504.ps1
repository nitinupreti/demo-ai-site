$base = 'http://localhost:4504'
$auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin'))
$headers = @{ Authorization = "Basic $auth"; Referer = "$base/" }
$csrf = ((Invoke-WebRequest -Uri "$base/libs/granite/csrf/token.json" -Headers $headers -UseBasicParsing).Content | ConvertFrom-Json).token
$headers['CSRF-Token'] = $csrf
$hero = '/content/demo-ai-site/figma/e-learning-landing/jcr:content/root/container/container/hero'

Invoke-WebRequest -Uri "$base$hero" -Method Post -Headers $headers -UseBasicParsing -Body @{
  style = 'full-bleed'
  brandName = 'TOTC'
  titleAccent = 'Studying'
  title = ' Online is now much easier'
  description = '<p>TOTC is an interesting platform that will teach you in a more interactive way.</p>'
  image = '/content/dam/demo-ai-site/design/figma/raw_02.png'
  imageAlt = 'Student attending an online class'
  primaryLabel = 'Join for free'
  primaryLink = '#join'
  secondaryLabel = 'Watch how it works'
  secondaryLink = '#watch'
  loginLabel = 'Login'
  loginLink = '#login'
  signupLabel = 'Sign Up'
  signupLink = '#signup'
} | Out-Null

foreach ($child in @('navItems', 'statusItems')) {
  try {
    Invoke-WebRequest -Uri "$base$hero/$child" -Method Post -Headers $headers -UseBasicParsing -Body @{ ':operation' = 'delete' } -ErrorAction Stop | Out-Null
  } catch {}
}

function Add-Node($parent, $name, $properties) {
  $body = @{ ':name' = $name; 'jcr:primaryType' = 'nt:unstructured' }
  foreach ($key in $properties.Keys) { $body[$key] = $properties[$key] }
  Invoke-WebRequest -Uri "$base$parent/*" -Method Post -Headers $headers -UseBasicParsing -Body $body | Out-Null
}

Add-Node $hero 'navItems' @{}
$navItems = @(
  @{ Name = 'home'; Label = 'Home'; Link = '#home' },
  @{ Name = 'courses'; Label = 'Courses'; Link = '#courses' },
  @{ Name = 'careers'; Label = 'Careers'; Link = '#careers' },
  @{ Name = 'blog'; Label = 'Blog'; Link = '#blog' },
  @{ Name = 'about'; Label = 'About Us'; Link = '#about' }
)
foreach ($item in $navItems) { Add-Node "$hero/navItems" $item.Name @{ label = $item.Label; link = $item.Link } }

Add-Node $hero 'statusItems' @{}
Add-Node "$hero/statusItems" 'students' @{ title = '250k'; detail = 'Assisted Student' }
Add-Node "$hero/statusItems" 'admission' @{ title = 'Congratulations'; detail = 'Your admission completed' }
Add-Node "$hero/statusItems" 'class' @{ title = 'User Experience Class'; detail = 'Today at 12.00 PM'; actionLabel = 'Join Now' }

$html = (Invoke-WebRequest -Uri "$base/content/demo-ai-site/figma/e-learning-landing.html?wcmmode=disabled&hero=fresh" -Headers $headers -UseBasicParsing).Content
[pscustomobject]@{
  FullBleed = ([regex]::Matches($html, 'cmp-hero--style-full-bleed')).Count
  NavigationItems = ([regex]::Matches($html, 'cmp-hero__navigation-item')).Count
  StatusCards = ([regex]::Matches($html, 'cmp-hero__status-card')).Count
  SightlyExceptions = ([regex]::Matches($html, 'SightlyException')).Count
} | Format-List
