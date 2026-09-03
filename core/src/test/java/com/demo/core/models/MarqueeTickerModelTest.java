/*
 * Copyright 2026 Demo AI Site
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 */
package com.demo.core.models;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import com.day.cq.wcm.api.Page;

import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;

@ExtendWith(AemContextExtension.class)
class MarqueeTickerModelTest {

    private static final String RT = "demo-ai-site/components/marquee-ticker";
    private final AemContext context = new AemContext();
    private Page page;

    @BeforeEach
    void setUp() {
        context.addModelsForClasses(MarqueeTickerModel.class);
        page = context.create().page("/content/demo-ai-site/test-page");
    }

    @Test
    void testComplete() {
        Resource r = context.create().resource(page, "t",
                "sling:resourceType", RT,
                "phrase", "AI-driven",
                "iconPath", "/content/dam/icon.svg",
                "iconAlt", "Sparks",
                "count", 12);
        MarqueeTickerModel m = r.adaptTo(MarqueeTickerModel.class);
        assertNotNull(m);
        assertEquals("AI-driven", m.getPhrase());
        assertEquals("/content/dam/icon.svg", m.getIconPath());
        assertEquals("Sparks", m.getIconAlt());
        assertEquals(12, m.getItems().size());
        assertTrue(m.isHasContent());
    }

    @Test
    void testDefaultCountWhenUnset() {
        Resource r = context.create().resource(page, "t",
                "sling:resourceType", RT,
                "phrase", "Hi");
        MarqueeTickerModel m = r.adaptTo(MarqueeTickerModel.class);
        assertNotNull(m);
        assertEquals(12, m.getItems().size());
    }

    @Test
    void testCountClampedToMax() {
        Resource r = context.create().resource(page, "t",
                "sling:resourceType", RT,
                "phrase", "Hi",
                "count", 99);
        MarqueeTickerModel m = r.adaptTo(MarqueeTickerModel.class);
        assertNotNull(m);
        assertEquals(30, m.getItems().size());
    }

    @Test
    void testEmpty() {
        Resource r = context.create().resource(page, "t", "sling:resourceType", RT);
        MarqueeTickerModel m = r.adaptTo(MarqueeTickerModel.class);
        assertNotNull(m);
        assertFalse(m.isHasContent());
    }

    @Test
    void testIconAltFallbackIsEmpty() {
        Resource r = context.create().resource(page, "t",
                "sling:resourceType", RT,
                "phrase", "Hi");
        MarqueeTickerModel m = r.adaptTo(MarqueeTickerModel.class);
        assertNotNull(m);
        assertEquals("", m.getIconAlt());
    }
}
