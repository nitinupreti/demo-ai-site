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
class IndustriesModelTest {

    private final AemContext context = new AemContext();
    private Page page;

    @BeforeEach
    void setUp() {
        context.addModelsForClasses(IndustriesModel.class, IndustryTile.class);
        page = context.create().page("/content/demo-ai-site/test-page");
    }

    @Test
    void testWithTiles() {
        Resource r = context.create().resource(page, "i", "sling:resourceType", "demo-ai-site/components/industries", "eyebrow", "Industry-Specific Expertise");
        context.create().resource(page, "i/tiles/item0", "label", "Consumer", "linkPath", "/content/demo-ai-site/us/en/industries/consumer");
        context.create().resource(page, "i/tiles/item1", "label", "Public sector");
        IndustriesModel m = r.adaptTo(IndustriesModel.class);
        assertNotNull(m);
        assertEquals(2, m.getTiles().size());
        assertEquals("Consumer", m.getTiles().get(0).getLabel());
        assertEquals("/content/demo-ai-site/us/en/industries/consumer.html", m.getTiles().get(0).getHref());
        assertNull(m.getTiles().get(1).getHref());
        assertTrue(m.isHasContent());
    }

    @Test
    void testEmpty() {
        Resource r = context.create().resource(page, "i", "sling:resourceType", "demo-ai-site/components/industries");
        IndustriesModel m = r.adaptTo(IndustriesModel.class);
        assertNotNull(m);
        assertFalse(m.isHasContent());
    }
}
