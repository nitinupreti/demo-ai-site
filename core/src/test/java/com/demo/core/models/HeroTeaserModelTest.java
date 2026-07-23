/*
 * Copyright 2026 Adobe Systems Incorporated
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
package com.demo.core.models;

import com.demo.core.testcontext.AppAemContext;
import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;
import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@ExtendWith(AemContextExtension.class)
class HeroTeaserModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource r = context.create().resource("/content/test/empty",
            "sling:resourceType", "demo-ai-site/components/hero-teaser");
        HeroTeaserModel m = r.adaptTo(HeroTeaserModel.class);
        assertNotNull(m);
        assertEquals("mint", m.getBgStyle());
        assertNull(m.getTitle());
        assertNull(m.getSubtitle());
        assertFalse(m.isHasText());
        assertFalse(m.isHasImage());
        assertFalse(m.isHasContent());
    }

    @Test
    void configuredValues() {
        Resource r = context.create().resource("/content/test/full",
            "sling:resourceType", "demo-ai-site/components/hero-teaser",
            "title", "Financial Clarity You Can Trust",
            "subtitle", "Trusted financial guidance for every stage of life and business since 1987",
            "ctaLabel", "Connect with our experts",
            "ctaLink", "/content/demo-ai-site/us/en/contact",
            "bgStyle", "dark");
        context.create().resource(r, "image",
            "sling:resourceType", "core/wcm/components/image/v3/image",
            "fileReference", "/content/dam/demo-ai-site/hero.jpg");

        HeroTeaserModel m = r.adaptTo(HeroTeaserModel.class);
        assertNotNull(m);
        assertEquals("Financial Clarity You Can Trust", m.getTitle());
        assertEquals("Trusted financial guidance for every stage of life and business since 1987", m.getSubtitle());
        assertEquals("Connect with our experts", m.getCtaLabel());
        assertEquals("/content/demo-ai-site/us/en/contact", m.getCtaLink());
        assertEquals("dark", m.getBgStyle());
        assertTrue(m.isHasText());
        assertTrue(m.isHasImage());
        assertTrue(m.isHasContent());
    }
}
