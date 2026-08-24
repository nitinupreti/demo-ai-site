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
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@ExtendWith(AemContextExtension.class)
class FeaturePanelModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource r = context.create().resource("/content/test/fp",
                "sling:resourceType", "demo-ai-site/components/feature-panel");
        FeaturePanelModel m = r.adaptTo(FeaturePanelModel.class);
        assertNotNull(m);
        assertFalse(m.isHasContent());
        assertNull(m.getBackgroundStyle());
    }

    @Test
    void configuredFully() {
        Resource r = context.create().resource("/content/test/fp",
                "sling:resourceType", "demo-ai-site/components/feature-panel",
                "eyebrow", "New",
                "heading", "Meltzer Center for Athletic Performance",
                "body", "<p>It's a game changer.</p>",
                "backgroundImage", "/content/dam/demo-ai-site/design/meltzer.jpg",
                "videoLabel", "Play Video",
                "videoLink", "https://vimeo.com/1156881103");
        FeaturePanelModel m = r.adaptTo(FeaturePanelModel.class);
        assertNotNull(m);
        assertTrue(m.isHasContent());
        assertEquals("Meltzer Center for Athletic Performance", m.getHeading());
        assertTrue(m.getBackgroundStyle().contains("background-image"));
    }
}
