$css = 'ui.apps\src\main\content\jcr_root\apps\demo-ai-site\components\hero-carousel\clientlibs\clientlib-hero-carousel\css\hero-carousel.css'
$block = @'


/* --- Full-bleed style: image becomes background, overlay content anchors left. --- */
.cmp-hero-carousel--style-full-bleed {
    min-height: 460px;
    padding: 142px 20px;
    align-items: stretch;
    justify-content: flex-start;
}

.cmp-hero-carousel--style-full-bleed .cmp-hero-carousel__track {
    padding: 0;
    max-width: 1400px;
    width: 100%;
    display: flex;
}

.cmp-hero-carousel--style-full-bleed .cmp-hero-carousel__slide--active {
    display: block;
    position: static;
    grid-template-columns: none;
    gap: 0;
    width: 100%;
}

.cmp-hero-carousel--style-full-bleed .cmp-hero-carousel__media {
    position: absolute;
    inset: 0;
    z-index: 0;
    margin: 0;
    padding: 0;
    overflow: hidden;
    aspect-ratio: auto;
    border-radius: 0;
    box-shadow: none;
}

.cmp-hero-carousel--style-full-bleed .cmp-hero-carousel__image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}

.cmp-hero-carousel--style-full-bleed .cmp-hero-carousel__content {
    position: relative;
    z-index: 2;
    max-width: 960px;
    text-align: left;
    padding: 0;
}

.cmp-hero-carousel--style-full-bleed .cmp-hero-carousel__title {
    font-family: Inter, "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 88px;
    font-weight: 500;
    line-height: 1.04;
    letter-spacing: normal;
    max-width: 960px;
    margin: 0;
}

@media (max-width: 1024px) {
    .cmp-hero-carousel--style-full-bleed {
        padding: 142px 20px;
    }
    .cmp-hero-carousel--style-full-bleed .cmp-hero-carousel__title {
        font-size: 60px;
        line-height: 1.09;
    }
}

@media (max-width: 640px) {
    .cmp-hero-carousel--style-full-bleed {
        padding: 60px 20px 150px;
    }
    .cmp-hero-carousel--style-full-bleed .cmp-hero-carousel__title {
        font-size: 48px;
        line-height: 1.14;
    }
}
'@
Add-Content -Path $css -Value $block -NoNewline
Write-Host "CSS appended. Size=$((Get-Item $css).Length)"
