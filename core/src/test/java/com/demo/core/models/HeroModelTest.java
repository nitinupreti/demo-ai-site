/*
 * Unit tests for HeroModel.
 */
package com.demo.core.models;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import com.demo.core.testcontext.AppAemContext;

import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;

@ExtendWith(AemContextExtension.class)
class HeroModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource resource = context.create().resource("/content/test/hero",
                "sling:resourceType", "demo-ai-site/components/hero");
        HeroModel model = resource.adaptTo(HeroModel.class);
        assertNotNull(model);
        assertEquals("default", model.getStyle());
        assertNull(model.getTagline());
        assertNull(model.getHeading());
        assertNull(model.getBackgroundStyle());
        assertTrue(model.isShowDecorations());
        assertFalse(model.isHasContent());
        assertEquals("#", model.getCtaLink());
        assertEquals("#", model.getPlayLink());
    }

    @Test
    void configuredFully() {
        Resource resource = context.create().resource("/content/test/hero",
                "sling:resourceType", "demo-ai-site/components/hero",
                "style", "default",
                "tagline", "Best Destinations around the world",
                "heading", "Travel, <span>enjoy</span> and live",
                "description", "Some description text.",
                "ctaLabel", "Find out more",
                "ctaLink", "/content/demo-ai-site/us/en.html",
                "playLabel", "Play Demo",
                "playLink", "/content/demo-ai-site/us/en/video.html",
                "image", "/content/dam/demo-ai-site/design/hero-woman.png",
                "imageAlt", "Traveler",
                "showDecorations", Boolean.TRUE,
                "background", "other",
                "backgroundHex", "FFF1DA");
        HeroModel model = resource.adaptTo(HeroModel.class);
        assertNotNull(model);
        assertEquals("default", model.getStyle());
        assertEquals("Best Destinations around the world", model.getTagline());
        assertEquals("Find out more", model.getCtaLabel());
        assertEquals("/content/demo-ai-site/us/en.html", model.getCtaLink());
        assertEquals("Play Demo", model.getPlayLabel());
        assertEquals("Traveler", model.getImageAlt());
        assertTrue(model.isShowDecorations());
        assertEquals("background-color: #FFF1DA;", model.getBackgroundStyle());
        assertTrue(model.isHasContent());
    }

    @Test
    void insightsStyle() {
        Resource resource = context.create().resource("/content/test/hero-insights",
                "sling:resourceType", "demo-ai-site/components/hero",
                "style", "insights",
                "heading", "Lessons and insights <span class=\"cmp-hero__heading-highlight\">from 8 years</span>",
                "description", "Where to grow your business as a photographer: site or social media?",
                "ctaLabel", "Register",
                "ctaLink", "/content/demo-ai-site/us/en/insights-hero-demo.html",
                "image", "/content/dam/demo-ai-site/design/insights-illustration.svg",
                "imageAlt", "Isometric illustration");
        HeroModel model = resource.adaptTo(HeroModel.class);
        assertNotNull(model);
        assertEquals("insights", model.getStyle());
        assertEquals("Register", model.getCtaLabel());
        assertEquals("/content/demo-ai-site/us/en/insights-hero-demo.html", model.getCtaLink());
        assertEquals("/content/dam/demo-ai-site/design/insights-illustration.svg", model.getImage());
        assertEquals("Isometric illustration", model.getImageAlt());
        assertNull(model.getBackgroundStyle());
        assertTrue(model.isHasContent());
    }
}
