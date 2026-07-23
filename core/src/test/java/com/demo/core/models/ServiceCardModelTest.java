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
class ServiceCardModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource r = context.create().resource("/content/test/card-empty",
            "sling:resourceType", "demo-ai-site/components/service-card");
        ServiceCardModel m = r.adaptTo(ServiceCardModel.class);
        assertNotNull(m);
        assertEquals("right", m.getMargin());
        assertEquals("mint", m.getBackgroundColor());
        assertNull(m.getBackgroundStyle());
        assertFalse(m.isHasContent());
        assertTrue(m.getCtas().isEmpty());
    }

    @Test
    void configuredWithCtas() {
        Resource r = context.create().resource("/content/test/card-full",
            "sling:resourceType", "demo-ai-site/components/service-card",
            "title", "Tax Preparation & Filing",
            "description", "Accurately prepare and file personal and business tax returns.",
            "imagePath", "/content/dam/demo-ai-site/asset.jpg",
            "backgroundColor", "other",
            "backgroundColorHex", "#C8F1C2",
            "margin", "left");
        Resource ctas = context.create().resource(r, "ctas");
        context.create().resource(ctas, "item0",
            "ctaTitle", "1099 taxes",
            "ctaLink", "/content/demo-ai-site/us/en");
        context.create().resource(ctas, "item1",
            "ctaTitle", "Dependents",
            "ctaLink", "/content/demo-ai-site/us/en");
        context.create().resource(ctas, "item2",
            "ctaTitle", "Trust Taxes",
            "ctaLink", "/content/demo-ai-site/us/en");

        ServiceCardModel m = r.adaptTo(ServiceCardModel.class);
        assertNotNull(m);
        assertEquals("Tax Preparation & Filing", m.getTitle());
        assertEquals("/content/dam/demo-ai-site/asset.jpg", m.getImagePath());
        assertEquals("other", m.getBackgroundColor());
        assertEquals("#C8F1C2", m.getBackgroundColorHex());
        assertEquals("background-color: #C8F1C2;", m.getBackgroundStyle());
        assertEquals("left", m.getMargin());
        assertEquals(3, m.getCtas().size());
        assertEquals("1099 taxes", m.getCtas().get(0).getCtaTitle());
        assertEquals("/content/demo-ai-site/us/en", m.getCtas().get(0).getCtaLink());
        assertTrue(m.isHasCtas());
        assertTrue(m.isHasContent());
    }
}
