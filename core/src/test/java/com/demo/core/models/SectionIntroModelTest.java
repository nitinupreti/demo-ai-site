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
import static org.junit.jupiter.api.Assertions.assertTrue;

@ExtendWith(AemContextExtension.class)
class SectionIntroModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource r = context.create().resource("/content/test/intro-empty",
            "sling:resourceType", "demo-ai-site/components/section-intro");
        SectionIntroModel m = r.adaptTo(SectionIntroModel.class);
        assertNotNull(m);
        assertEquals("center", m.getAlign());
        assertEquals("light", m.getTheme());
        assertFalse(m.isHasContent());
    }

    @Test
    void configured() {
        Resource r = context.create().resource("/content/test/intro-full",
            "sling:resourceType", "demo-ai-site/components/section-intro",
            "eyebrow", "Services",
            "title", "Let us handle the numbers, so you can handle your success.",
            "subtitle", "Serving individuals and small businesses since 1987",
            "ctaLabel", "Learn more",
            "ctaLink", "/content/demo-ai-site/us/en/services",
            "align", "left",
            "theme", "dark");
        SectionIntroModel m = r.adaptTo(SectionIntroModel.class);
        assertNotNull(m);
        assertEquals("Services", m.getEyebrow());
        assertEquals("Learn more", m.getCtaLabel());
        assertEquals("left", m.getAlign());
        assertEquals("dark", m.getTheme());
        assertTrue(m.isHasText());
        assertTrue(m.isHasContent());
    }
}
