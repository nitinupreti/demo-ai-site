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
class CardStripModelTest {

    private final AemContext ctx = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource res = ctx.create().resource("/content/cs-empty",
                "sling:resourceType", "demo-ai-site/components/card-strip");
        CardStripModel m = res.adaptTo(CardStripModel.class);
        assertFalse(m.isHasContent());
        assertTrue(m.getCards().isEmpty());
        assertEquals("light", m.getBackground());
        assertNull(m.getEyebrow());
    }

    @Test
    void configuredFully() {
        Resource root = ctx.create().resource("/content/cs",
                "sling:resourceType", "demo-ai-site/components/card-strip",
                "eyebrow", "WHAT'S NEW",
                "background", "light");
        Resource cards = ctx.create().resource(root, "cards");
        ctx.create().resource(cards, "item0",
                "title", "Card One", "description", "Body one",
                "ctaLabel", "Read now", "ctaLink", "#");
        ctx.create().resource(cards, "item1",
                "title", "Card Two", "description", "Body two",
                "ctaLabel", "Watch now", "ctaLink", "#");

        CardStripModel m = root.adaptTo(CardStripModel.class);
        assertTrue(m.isHasContent());
        assertEquals("WHAT'S NEW", m.getEyebrow());
        assertEquals(2, m.getCards().size());
        assertEquals("Card One", m.getCards().get(0).getTitle());
    }
}
