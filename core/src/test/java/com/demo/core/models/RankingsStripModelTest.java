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
class RankingsStripModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource r = context.create().resource("/content/test/rs",
                "sling:resourceType", "demo-ai-site/components/rankings-strip");
        RankingsStripModel m = r.adaptTo(RankingsStripModel.class);
        assertNotNull(m);
        assertFalse(m.isHasContent());
        assertTrue(m.getRankings().isEmpty());
    }

    @Test
    void configuredFully() {
        Resource r = context.create().resource("/content/test/rs",
                "sling:resourceType", "demo-ai-site/components/rankings-strip",
                "heading", "AU by the numbers");
        context.create().resource(r.getPath() + "/rankings/i0",
                "rank", "#5", "description", "for Study Abroad", "source", "U.S. News 2026");
        context.create().resource(r.getPath() + "/rankings/i1",
                "rank", "#2", "description", "for Green Colleges", "source", "Princeton Review 2026");
        RankingsStripModel m = r.adaptTo(RankingsStripModel.class);
        assertNotNull(m);
        assertTrue(m.isHasContent());
        assertEquals(2, m.getRankings().size());
        assertEquals("#5", m.getRankings().get(0).getRank());
    }
}
