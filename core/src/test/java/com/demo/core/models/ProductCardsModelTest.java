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
class ProductCardsModelTest {

    private final AemContext ctx = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource res = ctx.create().resource("/content/pc-empty",
                "sling:resourceType", "demo-ai-site/components/product-cards");
        ProductCardsModel m = res.adaptTo(ProductCardsModel.class);
        assertFalse(m.isHasContent());
        assertEquals("3", m.getColumns());
        assertTrue(m.getCards().isEmpty());
    }

    @Test
    void configuredFully() {
        Resource root = ctx.create().resource("/content/pc",
                "sling:resourceType", "demo-ai-site/components/product-cards",
                "columns", "3");
        Resource cards = ctx.create().resource(root, "cards");
        ctx.create().resource(cards, "item0",
                "title", "Oligos", "description", "d",
                "ctaLabel", "EXPLORE", "ctaLink", "#");
        ctx.create().resource(cards, "item1",
                "title", "CRISPR", "description", "d",
                "ctaLabel", "EXPLORE", "ctaLink", "#");

        ProductCardsModel m = root.adaptTo(ProductCardsModel.class);
        assertTrue(m.isHasContent());
        assertEquals("3", m.getColumns());
        assertEquals(2, m.getCards().size());
        assertEquals("Oligos", m.getCards().get(0).getTitle());
    }
}
