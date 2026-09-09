package com.demo.core.models;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;

@ExtendWith(AemContextExtension.class)
class HeroTest {

    private final AemContext context = new AemContext();

    @BeforeEach
    void setUp() {
        context.addModelsForClasses(Hero.class);
    }

    @Test
    void testCompleteHero() {
        Resource resource = context.create().resource("/content/hero",
                "headline", "Headline",
                "mediaPath", "/content/dam/hero.jpg",
                "mediaAlt", "Portrait",
                "brandLogoPath", "/content/dam/logo.svg",
                "brandLogoAlt", "Partner",
                "videoEmbedUrl", "https://www.youtube-nocookie.com/embed/example",
                "videoTitle", "Customer video");

        Hero hero = resource.adaptTo(Hero.class);

        assertNotNull(hero);
        assertEquals("Headline", hero.getHeadline());
        assertEquals("Portrait", hero.getMediaAlt());
        assertEquals("/content/dam/logo.svg", hero.getBrandLogoPath());
        assertEquals("Partner", hero.getBrandLogoAlt());
        assertEquals("Customer video", hero.getVideoTitle());
        assertTrue(hero.isHasVideo());
        assertTrue(hero.isHasContent());
    }

    @Test
    void testEmptyHero() {
        Hero hero = context.create().resource("/content/hero").adaptTo(Hero.class);

        assertNotNull(hero);
        assertEquals("", hero.getMediaAlt());
        assertEquals("", hero.getBrandLogoAlt());
        assertFalse(hero.isHasVideo());
        assertFalse(hero.isHasContent());
    }
}