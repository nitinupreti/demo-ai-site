/*
 * Copyright 2024 Adobe Systems Incorporated
 * Licensed under the Apache License, Version 2.0
 */
package com.demo.core.models;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import com.demo.core.testcontext.AppAemContext;

import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;

@ExtendWith(AemContextExtension.class)
class HeroCarouselModelTest {

    private final AemContext ctx = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource res = ctx.create().resource("/content/hero-empty",
                "sling:resourceType", "demo-ai-site/components/hero-carousel");
        HeroCarouselModel model = res.adaptTo(HeroCarouselModel.class);
        assertFalse(model.isHasContent());
        assertTrue(model.getSlides().isEmpty());
        assertEquals("dark", model.getTheme());
        assertTrue(model.isAutoRotate());
    }

    @Test
    void configuredFully() {
        Resource root = ctx.create().resource("/content/hero",
                "sling:resourceType", "demo-ai-site/components/hero-carousel",
                "autoRotate", true,
                "theme", "dark");
        Resource slides = ctx.create().resource(root, "slides");
        ctx.create().resource(slides, "item0",
                "title", "Discover what's possible",
                "description", "Longer, more complex gene constructs.",
                "ctaLabel", "START HERE",
                "ctaLink", "#");

        HeroCarouselModel model = root.adaptTo(HeroCarouselModel.class);
        assertTrue(model.isHasContent());
        assertEquals(1, model.getSlides().size());
        assertEquals("Discover what's possible", model.getSlides().get(0).getTitle());
        assertEquals("dark", model.getTheme());
    }
}
