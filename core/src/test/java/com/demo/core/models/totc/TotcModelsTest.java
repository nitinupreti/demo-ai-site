/*
 * Compact tests for the TOTC Sling Models.
 * Each model gets defaultsWhenEmpty + configuredFully coverage.
 */
package com.demo.core.models.totc;

import static org.junit.jupiter.api.Assertions.*;

import java.util.HashMap;
import java.util.Map;

import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import com.demo.core.testcontext.AppAemContext;

import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;

@ExtendWith(AemContextExtension.class)
class TotcModelsTest {

    private final AemContext context = AppAemContext.newAemContext();

    // ---------- SiteHeaderModel ----------
    @Test
    void siteHeader_defaults() {
        Resource r = context.create().resource("/content/t/siteHeader",
                "sling:resourceType", "demo-ai-site/components/totc-site-header");
        SiteHeaderModel m = r.adaptTo(SiteHeaderModel.class);
        assertNotNull(m);
        assertEquals("TOTC", m.getLogoText());
        assertEquals("Login", m.getLoginLabel());
        assertEquals("Sign Up", m.getSignupLabel());
        assertEquals("onHero", m.getTheme());
        assertNotNull(m.getNavLinks());
        assertTrue(m.getNavLinks().isEmpty());
        assertTrue(m.isHasContent());
    }

    @Test
    void siteHeader_configured() {
        Resource r = context.create().resource("/content/t/siteHeader2",
                "sling:resourceType", "demo-ai-site/components/totc-site-header",
                "logoText", "MyBrand", "loginLabel", "Sign in", "theme", "light");
        Resource links = context.create().resource("/content/t/siteHeader2/navLinks");
        context.create().resource(links, "item0",
                Map.of("label", "Home", "link", "/content/home"));
        context.create().resource(links, "item1",
                Map.of("label", "About"));
        // Include one blank link that should be filtered out
        context.create().resource(links, "item2",
                new HashMap<String, Object>());
        SiteHeaderModel m = r.adaptTo(SiteHeaderModel.class);
        assertNotNull(m);
        assertEquals("MyBrand", m.getLogoText());
        assertEquals("Sign in", m.getLoginLabel());
        assertEquals("light", m.getTheme());
        assertEquals(2, m.getNavLinks().size());
        assertEquals("Home", m.getNavLinks().get(0).getLabel());
    }

    // ---------- HeroModel ----------
    @Test
    void hero_defaults() {
        Resource r = context.create().resource("/content/t/hero",
                "sling:resourceType", "demo-ai-site/components/totc-hero");
        HeroModel m = r.adaptTo(HeroModel.class);
        assertNotNull(m);
        assertNull(m.getTitlePrefix());
        assertNull(m.getTitleRest());
        assertEquals("Join for free", m.getPrimaryCtaLabel());
        assertTrue(m.getFloatingCards().isEmpty());
        assertFalse(m.isHasContent());
    }

    @Test
    void hero_configured() {
        Resource r = context.create().resource("/content/t/hero2",
                "sling:resourceType", "demo-ai-site/components/totc-hero",
                "titlePrefix", "Studying", "titleRest", "Online is easy",
                "subtitle", "sub", "heroImage", "/content/dam/a.png");
        Resource cards = context.create().resource("/content/t/hero2/floatingCards");
        context.create().resource(cards, "c0",
                Map.of("title", "250k", "subtitle", "Students", "iconStyle", "blue"));
        HeroModel m = r.adaptTo(HeroModel.class);
        assertNotNull(m);
        assertEquals("Studying", m.getTitlePrefix());
        assertEquals(1, m.getFloatingCards().size());
        assertEquals("blue", m.getFloatingCards().get(0).getIconStyle());
        assertTrue(m.isHasContent());
    }

    // ---------- SectionTitleModel ----------
    @Test
    void sectionTitle_defaults() {
        Resource r = context.create().resource("/content/t/st",
                "sling:resourceType", "demo-ai-site/components/totc-section-title");
        SectionTitleModel m = r.adaptTo(SectionTitleModel.class);
        assertNotNull(m);
        assertEquals("center", m.getAlign());
        assertEquals("navy", m.getTitleColor());
        assertEquals("lg", m.getPadTop());
        assertFalse(m.isHasContent());
    }

    @Test
    void sectionTitle_configured() {
        Resource r = context.create().resource("/content/t/st2",
                "sling:resourceType", "demo-ai-site/components/totc-section-title",
                "title", "Hi", "subtitle", "there", "align", "left");
        SectionTitleModel m = r.adaptTo(SectionTitleModel.class);
        assertNotNull(m);
        assertEquals("Hi", m.getTitle());
        assertEquals("left", m.getAlign());
        assertTrue(m.isHasContent());
    }

    // ---------- StatsStripModel ----------
    @Test
    void statsStrip_defaults() {
        Resource r = context.create().resource("/content/t/ss",
                "sling:resourceType", "demo-ai-site/components/totc-stats-strip");
        StatsStripModel m = r.adaptTo(StatsStripModel.class);
        assertNotNull(m);
        assertTrue(m.getStats().isEmpty());
        assertFalse(m.isHasContent());
    }

    @Test
    void statsStrip_configured() {
        Resource r = context.create().resource("/content/t/ss2",
                "sling:resourceType", "demo-ai-site/components/totc-stats-strip");
        Resource stats = context.create().resource("/content/t/ss2/stats");
        context.create().resource(stats, "s0", Map.of("value", "15K+", "label", "Students"));
        context.create().resource(stats, "s1", Map.of("value", "75%", "label", "Success"));
        StatsStripModel m = r.adaptTo(StatsStripModel.class);
        assertNotNull(m);
        assertEquals(2, m.getStats().size());
        assertEquals("15K+", m.getStats().get(0).getValue());
        assertTrue(m.isHasContent());
    }

    // ---------- FeatureCardsModel ----------
    @Test
    void featureCards_defaults() {
        Resource r = context.create().resource("/content/t/fc",
                "sling:resourceType", "demo-ai-site/components/totc-feature-cards");
        FeatureCardsModel m = r.adaptTo(FeatureCardsModel.class);
        assertNotNull(m);
        assertTrue(m.getCards().isEmpty());
        assertFalse(m.isHasContent());
    }

    @Test
    void featureCards_configured() {
        Resource r = context.create().resource("/content/t/fc2",
                "sling:resourceType", "demo-ai-site/components/totc-feature-cards");
        Resource cards = context.create().resource("/content/t/fc2/cards");
        context.create().resource(cards, "c0",
                Map.of("title", "Billing", "description", "desc", "iconVariant", "orange", "iconGlyph", "invoice"));
        FeatureCardsModel m = r.adaptTo(FeatureCardsModel.class);
        assertNotNull(m);
        assertEquals(1, m.getCards().size());
        assertEquals("orange", m.getCards().get(0).getIconVariant());
        assertTrue(m.isHasContent());
    }

    // ---------- SplitCardsModel ----------
    @Test
    void splitCards_defaults() {
        Resource r = context.create().resource("/content/t/sp",
                "sling:resourceType", "demo-ai-site/components/totc-split-cards");
        SplitCardsModel m = r.adaptTo(SplitCardsModel.class);
        assertNotNull(m);
        assertTrue(m.getCards().isEmpty());
        assertFalse(m.isHasContent());
    }

    @Test
    void splitCards_configured() {
        Resource r = context.create().resource("/content/t/sp2",
                "sling:resourceType", "demo-ai-site/components/totc-split-cards");
        Resource cards = context.create().resource("/content/t/sp2/cards");
        context.create().resource(cards, "c0",
                Map.of("label", "FOR INSTRUCTORS", "ctaLabel", "Start", "tint", "navy"));
        SplitCardsModel m = r.adaptTo(SplitCardsModel.class);
        assertNotNull(m);
        assertEquals(1, m.getCards().size());
        assertEquals("navy", m.getCards().get(0).getTint());
        assertTrue(m.isHasContent());
    }

    // ---------- ImageTextModel ----------
    @Test
    void imageText_defaults() {
        Resource r = context.create().resource("/content/t/it",
                "sling:resourceType", "demo-ai-site/components/totc-image-text");
        ImageTextModel m = r.adaptTo(ImageTextModel.class);
        assertNotNull(m);
        assertEquals("right", m.getImageSide());
        assertEquals("navy", m.getTitleColor());
        assertEquals("orange", m.getAccentColor());
        assertFalse(m.isPlayIcon());
        assertTrue(m.getBullets().isEmpty());
        assertFalse(m.isHasContent());
    }

    @Test
    void imageText_configured() {
        Resource r = context.create().resource("/content/t/it2",
                "sling:resourceType", "demo-ai-site/components/totc-image-text",
                "title", "Hello", "titleAccent", "Hi", "imageSide", "left",
                "playIcon", true);
        Resource bullets = context.create().resource("/content/t/it2/bullets");
        context.create().resource(bullets, "b0", Map.of("text", "one", "iconColor", "pink"));
        context.create().resource(bullets, "b1", Map.of("text", "two", "iconColor", "blue"));
        ImageTextModel m = r.adaptTo(ImageTextModel.class);
        assertNotNull(m);
        assertEquals("left", m.getImageSide());
        assertTrue(m.isPlayIcon());
        assertEquals(2, m.getBullets().size());
        assertTrue(m.isHasContent());
    }

    // ---------- CourseCarouselModel ----------
    @Test
    void courseCarousel_defaults() {
        Resource r = context.create().resource("/content/t/cc",
                "sling:resourceType", "demo-ai-site/components/totc-course-carousel");
        CourseCarouselModel m = r.adaptTo(CourseCarouselModel.class);
        assertNotNull(m);
        assertEquals("palette", m.getCategoryIcon());
        assertEquals("SEE ALL", m.getSeeAllLabel());
        assertEquals("EXPLORE", m.getFeaturedCta());
        assertEquals(6, m.getFeaturedPosition());
        assertTrue(m.getBooks().isEmpty());
        assertFalse(m.isHasContent());
    }

    @Test
    void courseCarousel_configured() {
        Resource r = context.create().resource("/content/t/cc2",
                "sling:resourceType", "demo-ai-site/components/totc-course-carousel",
                "categoryLabel", "Lorem", "categoryIcon", "globe",
                "featuredTitle", "Feat", "featuredPosition", 2L);
        Resource books = context.create().resource("/content/t/cc2/books");
        context.create().resource(books, "b0", Map.of("title", "Ut Sed Eros", "color", "orange"));
        context.create().resource(books, "b1", Map.of("title", "Another", "color", "yellow"));
        CourseCarouselModel m = r.adaptTo(CourseCarouselModel.class);
        assertNotNull(m);
        assertEquals("Lorem", m.getCategoryLabel());
        assertEquals(2, m.getFeaturedPosition());
        assertEquals(2, m.getBooks().size());
        assertTrue(m.isHasContent());
    }

    // ---------- TestimonialModel ----------
    @Test
    void testimonial_defaults() {
        Resource r = context.create().resource("/content/t/tm",
                "sling:resourceType", "demo-ai-site/components/totc-testimonial");
        TestimonialModel m = r.adaptTo(TestimonialModel.class);
        assertNotNull(m);
        assertEquals("TESTIMONIAL", m.getEyebrow());
        assertEquals(5, m.getRating());
        assertFalse(m.isHasContent());
    }

    @Test
    void testimonial_configured() {
        Resource r = context.create().resource("/content/t/tm2",
                "sling:resourceType", "demo-ai-site/components/totc-testimonial",
                "title", "What They Say?", "quote", "<p>Great!</p>",
                "author", "Jane", "rating", 4L);
        TestimonialModel m = r.adaptTo(TestimonialModel.class);
        assertNotNull(m);
        assertEquals("Jane", m.getAuthor());
        assertEquals(4, m.getRating());
        assertTrue(m.isHasContent());
    }

    // ---------- NewsCardsModel ----------
    @Test
    void newsCards_defaults() {
        Resource r = context.create().resource("/content/t/nc",
                "sling:resourceType", "demo-ai-site/components/totc-news-cards");
        NewsCardsModel m = r.adaptTo(NewsCardsModel.class);
        assertNotNull(m);
        assertEquals("NEWS", m.getHeroLabel());
        assertEquals("pink", m.getHeroLabelColor());
        assertEquals("Read more", m.getHeroCta());
        assertTrue(m.getSideCards().isEmpty());
        assertFalse(m.isHasContent());
    }

    @Test
    void newsCards_configured() {
        Resource r = context.create().resource("/content/t/nc2",
                "sling:resourceType", "demo-ai-site/components/totc-news-cards",
                "heroTitle", "Big news");
        Resource side = context.create().resource("/content/t/nc2/sideCards");
        context.create().resource(side, "s0", Map.of("title", "Side 1", "summary", "sum", "label", "NEWS", "labelColor", "peach"));
        NewsCardsModel m = r.adaptTo(NewsCardsModel.class);
        assertNotNull(m);
        assertEquals(1, m.getSideCards().size());
        assertEquals("peach", m.getSideCards().get(0).getLabelColor());
        assertTrue(m.isHasContent());
    }

    // ---------- NewsletterFooterModel ----------
    @Test
    void newsletterFooter_defaults() {
        Resource r = context.create().resource("/content/t/nf",
                "sling:resourceType", "demo-ai-site/components/totc-newsletter-footer");
        NewsletterFooterModel m = r.adaptTo(NewsletterFooterModel.class);
        assertNotNull(m);
        assertEquals("Subscribe to get our Newsletter", m.getNewsletterTitle());
        assertEquals("TOTC", m.getLogoText());
        assertEquals("© 2021 Class Technologies Inc.", m.getCopyright());
        assertTrue(m.getFooterLinks().isEmpty());
        assertTrue(m.isHasContent());
    }

    @Test
    void newsletterFooter_configured() {
        Resource r = context.create().resource("/content/t/nf2",
                "sling:resourceType", "demo-ai-site/components/totc-newsletter-footer",
                "logoText", "Brand", "copyright", "(c) 2026");
        Resource links = context.create().resource("/content/t/nf2/footerLinks");
        context.create().resource(links, "l0", Map.of("label", "Careers"));
        context.create().resource(links, "l1", Map.of("label", "Privacy", "link", "/privacy"));
        NewsletterFooterModel m = r.adaptTo(NewsletterFooterModel.class);
        assertNotNull(m);
        assertEquals("Brand", m.getLogoText());
        assertEquals(2, m.getFooterLinks().size());
        assertTrue(m.isHasContent());
    }
}
