/*
 * Copyright 2026 Demo AI Site
 * Licensed under the Apache License, Version 2.0.
 */
package com.demo.core.models;

import static org.junit.jupiter.api.Assertions.*;

import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import com.day.cq.wcm.api.Page;
import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;

@ExtendWith(AemContextExtension.class)
class PartnersModelTest {

    private static final String RT = "demo-ai-site/components/partners";
    private final AemContext context = new AemContext();
    private Page page;

    @BeforeEach
    void setUp() {
        context.addModelsForClasses(PartnersModel.class, PartnerCard.class);
        page = context.create().page("/content/demo-ai-site/test-page");
    }

    @Test
    void testWithCards() {
        Resource r = context.create().resource(page, "p", "sling:resourceType", RT, "eyebrow", "Partners in Performance");
        context.create().resource(page, "p/cards/item0", "title", "Adobe", "body", "Adobe teams", "linkPath", "/content/demo-ai-site/us/en/partners/adobe", "bgColor", "#632F3C");
        context.create().resource(page, "p/cards/item1", "title", "AWS", "body", "AWS teams", "bgColor", "invalid");
        PartnersModel model = r.adaptTo(PartnersModel.class);
        assertNotNull(model);
        assertEquals("Partners in Performance", model.getEyebrow());
        assertEquals(2, model.getCards().size());
        assertEquals("Adobe", model.getCards().get(0).getTitle());
        assertEquals("/content/demo-ai-site/us/en/partners/adobe.html", model.getCards().get(0).getHref());
        assertEquals("#632F3C", model.getCards().get(0).getSafeBg());
        assertEquals("background-color:#632F3C", model.getCards().get(0).getStyleDeclarations());
        assertEquals("", model.getCards().get(1).getSafeBg());
        assertEquals("", model.getCards().get(1).getStyleDeclarations());
        assertTrue(model.isHasContent());
    }

    @Test
    void testEmpty() {
        Resource r = context.create().resource(page, "p", "sling:resourceType", RT);
        PartnersModel model = r.adaptTo(PartnersModel.class);
        assertNotNull(model);
        assertTrue(model.getCards().isEmpty());
        assertFalse(model.isHasContent());
    }

    @Test
    void testInvalidCardsAreDropped() {
        Resource r = context.create().resource(page, "p", "sling:resourceType", RT, "eyebrow", "P");
        context.create().resource(page, "p/cards/item0"); // no title, no body → empty
        PartnersModel model = r.adaptTo(PartnersModel.class);
        assertNotNull(model);
        assertEquals(0, model.getCards().size());
    }
}
