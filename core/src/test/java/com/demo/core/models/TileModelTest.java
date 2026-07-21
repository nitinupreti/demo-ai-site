/*
 *  Copyright 2026 Adobe Systems Incorporated
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 */
package com.demo.core.models;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import com.day.cq.wcm.api.Page;
import com.demo.core.testcontext.AppAemContext;

import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;

/**
 * Unit tests for {@link TileModel} and {@link CtaButton}.
 */
@ExtendWith(AemContextExtension.class)
class TileModelTest {

    private static final String RESOURCE_TYPE = "demo-ai-site/components/tile";

    private final AemContext context = AppAemContext.newAemContext();

    private Page page;

    @BeforeEach
    void setUp() {
        context.addModelsForClasses(TileModel.class, CtaButton.class);
        page = context.create().page("/content/demo-ai-site/test-page");
    }

    @Test
    void testWithCompleteData() {
        Resource tile = context.create().resource(page, "tile",
                "sling:resourceType", RESOURCE_TYPE,
                "title", "Tax Preparation & Filing",
                "description", "Accurately prepare and file personal and business tax returns.",
                "backgroundColor", "mint-green",
                "margin", "right",
                "image", "/content/dam/demo-ai-site/tile.jpg");

        context.create().resource(tile, "ctaButtons");
        context.create().resource(tile.getPath() + "/ctaButtons/item0",
                "ctaTitle", "1099 taxes",
                "ctaLink", "/content/demo-ai-site/en/1099");
        context.create().resource(tile.getPath() + "/ctaButtons/item1",
                "ctaTitle", "Dependents",
                "ctaLink", "/content/demo-ai-site/en/dependents");

        TileModel model = tile.adaptTo(TileModel.class);

        assertNotNull(model);
        assertEquals("Tax Preparation & Filing", model.getTitle());
        assertEquals("Accurately prepare and file personal and business tax returns.", model.getDescription());
        assertEquals("mint-green", model.getBackgroundColor());
        assertEquals("right", model.getMargin());
        assertEquals("/content/dam/demo-ai-site/tile.jpg", model.getImage());
        assertTrue(model.isHasContent());

        List<CtaButton> ctas = model.getCtaButtons();
        assertNotNull(ctas);
        assertEquals(2, ctas.size());
        assertEquals("1099 taxes", ctas.get(0).getCtaTitle());
        assertEquals("/content/demo-ai-site/en/1099", ctas.get(0).getCtaLink());
        assertEquals("Dependents", ctas.get(1).getCtaTitle());

        assertNull(model.getInlineStyle());
    }

    @Test
    void testDefaultBackgroundAndMargin() {
        Resource resource = context.create().resource(page, "tile",
                "sling:resourceType", RESOURCE_TYPE,
                "title", "Only title configured");

        TileModel model = resource.adaptTo(TileModel.class);

        assertNotNull(model);
        assertEquals("mint-green", model.getBackgroundColor());
        assertEquals("right", model.getMargin());
        assertTrue(model.getCtaButtons().isEmpty());
    }

    @Test
    void testCustomHexBackgroundRendersInlineStyle() {
        Resource resource = context.create().resource(page, "tile",
                "sling:resourceType", RESOURCE_TYPE,
                "title", "Custom color tile",
                "backgroundColor", "other",
                "backgroundColorHex", "#d2f8dc");

        TileModel model = resource.adaptTo(TileModel.class);

        assertNotNull(model);
        assertEquals("background-color:#d2f8dc", model.getInlineStyle());
    }

    @Test
    void testInvalidHexIsIgnored() {
        Resource resource = context.create().resource(page, "tile",
                "sling:resourceType", RESOURCE_TYPE,
                "title", "Bad hex tile",
                "backgroundColor", "other",
                "backgroundColorHex", "not-a-color");

        TileModel model = resource.adaptTo(TileModel.class);

        assertNotNull(model);
        assertNull(model.getInlineStyle());
    }

    @Test
    void testHexIgnoredWhenBackgroundNotOther() {
        Resource resource = context.create().resource(page, "tile",
                "sling:resourceType", RESOURCE_TYPE,
                "title", "Preset color tile",
                "backgroundColor", "mint-green",
                "backgroundColorHex", "#ff00ff");

        TileModel model = resource.adaptTo(TileModel.class);

        assertNotNull(model);
        assertNull(model.getInlineStyle());
    }

    @Test
    void testCtaWithoutRequiredFieldsIsFiltered() {
        Resource tile = context.create().resource(page, "tile",
                "sling:resourceType", RESOURCE_TYPE,
                "title", "Tile with mixed CTAs");
        context.create().resource(tile, "ctaButtons");
        context.create().resource(tile.getPath() + "/ctaButtons/item0",
                "ctaTitle", "Valid",
                "ctaLink", "/content/demo-ai-site/en/valid");
        context.create().resource(tile.getPath() + "/ctaButtons/item1",
                "ctaTitle", "No link only");

        TileModel model = tile.adaptTo(TileModel.class);

        assertNotNull(model);
        List<CtaButton> ctas = model.getCtaButtons();
        assertEquals(1, ctas.size());
        assertEquals("Valid", ctas.get(0).getCtaTitle());
    }

    @Test
    void testWhenEmpty() {
        Resource resource = context.create().resource(page, "tile",
                "sling:resourceType", RESOURCE_TYPE);

        TileModel model = resource.adaptTo(TileModel.class);

        assertNotNull(model);
        assertNull(model.getTitle());
        assertFalse(model.isHasContent());
    }

}
