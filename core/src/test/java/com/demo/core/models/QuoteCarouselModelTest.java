/*
 * Copyright 2024 Adobe Systems Incorporated
 * Licensed under the Apache License, Version 2.0
 */
package com.demo.core.models;

import static org.junit.jupiter.api.Assertions.*;

import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import com.demo.core.testcontext.AppAemContext;

import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;

@ExtendWith(AemContextExtension.class)
class QuoteCarouselModelTest {

    private final AemContext ctx = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource res = ctx.create().resource("/content/qc-empty",
                "sling:resourceType", "demo-ai-site/components/quote-carousel");
        QuoteCarouselModel m = res.adaptTo(QuoteCarouselModel.class);
        assertFalse(m.isHasContent());
        assertTrue(m.getQuotes().isEmpty());
    }

    @Test
    void configuredFully() {
        Resource root = ctx.create().resource("/content/qc",
                "sling:resourceType", "demo-ai-site/components/quote-carousel");
        Resource quotes = ctx.create().resource(root, "quotes");
        ctx.create().resource(quotes, "item0",
                "title", "Aldevron and IDT",
                "quote", "The impact of this work extends beyond this particular patient.",
                "attribution", "Dr. Kiran Musunuru",
                "ctaLabel", "READ MORE",
                "ctaLink", "#");

        QuoteCarouselModel m = root.adaptTo(QuoteCarouselModel.class);
        assertTrue(m.isHasContent());
        assertEquals(1, m.getQuotes().size());
        assertEquals("Dr. Kiran Musunuru", m.getQuotes().get(0).getAttribution());
    }
}
