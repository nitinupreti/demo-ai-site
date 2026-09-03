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
class InsightsListModelTest {
    private final AemContext context = new AemContext();
    private Page page;

    @BeforeEach
    void setUp() {
        context.addModelsForClasses(InsightsListModel.class, InsightCard.class);
        page = context.create().page("/content/demo-ai-site/test-page");
    }

    @Test
    void testWithCards() {
        Resource r = context.create().resource(page, "i", "sling:resourceType", "demo-ai-site/components/insights-list", "eyebrow", "Our take on what's next");
        context.create().resource(page, "i/cards/item0", "heading", "Adobe practice launched", "category", "Article / News", "linkPath", "/content/demo-ai-site/us/en/insights/adobe");
        context.create().resource(page, "i/cards/item1", "heading", "Agentic commerce", "category", "Article / Commerce");
        context.create().resource(page, "i/cards/item2"); // no heading → dropped
        InsightsListModel m = r.adaptTo(InsightsListModel.class);
        assertNotNull(m);
        assertEquals(2, m.getCards().size());
        assertEquals("Adobe practice launched", m.getCards().get(0).getHeading());
        assertEquals("/content/demo-ai-site/us/en/insights/adobe.html", m.getCards().get(0).getHref());
        assertTrue(m.isHasContent());
    }

    @Test
    void testEmpty() {
        Resource r = context.create().resource(page, "i", "sling:resourceType", "demo-ai-site/components/insights-list");
        InsightsListModel m = r.adaptTo(InsightsListModel.class);
        assertNotNull(m);
        assertFalse(m.isHasContent());
    }
}
