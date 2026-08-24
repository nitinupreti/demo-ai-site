/*
 * Copyright 2026 Demo AI Site
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
class NewsCardsModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource r = context.create().resource("/content/test/nc",
                "sling:resourceType", "demo-ai-site/components/news-cards");
        NewsCardsModel m = r.adaptTo(NewsCardsModel.class);
        assertNotNull(m);
        assertFalse(m.isHasContent());
        assertTrue(m.getCards().isEmpty());
    }

    @Test
    void configuredFully() {
        Resource r = context.create().resource("/content/test/nc",
                "sling:resourceType", "demo-ai-site/components/news-cards",
                "heading", "AU News");
        context.create().resource(r.getPath() + "/cards/c0",
                "headline", "AU on Capitol Hill",
                "description", "Where Washington Connections Become Careers",
                "link", "/x", "linkLabel", "Read More");
        NewsCardsModel m = r.adaptTo(NewsCardsModel.class);
        assertNotNull(m);
        assertTrue(m.isHasContent());
        assertEquals(1, m.getCards().size());
    }
}
