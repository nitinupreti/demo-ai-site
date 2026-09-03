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
class CaseStudyGridModelTest {
    private final AemContext context = new AemContext();
    private Page page;

    @BeforeEach
    void setUp() {
        context.addModelsForClasses(CaseStudyGridModel.class, InsightCard.class);
        page = context.create().page("/content/demo-ai-site/test-page");
    }

    @Test
    void testWithCards() {
        Resource r = context.create().resource(page, "c", "sling:resourceType", "demo-ai-site/components/case-study-grid",
                "viewAllLabel", "See all case studies",
                "viewAllLink", "/content/demo-ai-site/us/en/case-studies");
        context.create().resource(page, "c/cards/item0", "heading", "QSR case", "category", "Restaurants");
        CaseStudyGridModel m = r.adaptTo(CaseStudyGridModel.class);
        assertNotNull(m);
        assertEquals(1, m.getCards().size());
        assertEquals("See all case studies", m.getViewAllLabel());
        assertEquals("/content/demo-ai-site/us/en/case-studies.html", m.getViewAllHref());
        assertTrue(m.isHasContent());
    }

    @Test
    void testEmpty() {
        Resource r = context.create().resource(page, "c", "sling:resourceType", "demo-ai-site/components/case-study-grid");
        CaseStudyGridModel m = r.adaptTo(CaseStudyGridModel.class);
        assertNotNull(m);
        assertFalse(m.isHasContent());
    }
}
