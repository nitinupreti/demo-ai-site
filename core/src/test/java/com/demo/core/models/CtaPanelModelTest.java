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
class CtaPanelModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource r = context.create().resource("/content/test/cp",
                "sling:resourceType", "demo-ai-site/components/cta-panel");
        CtaPanelModel m = r.adaptTo(CtaPanelModel.class);
        assertNotNull(m);
        assertFalse(m.isHasContent());
        assertEquals("default", m.getStyle());
        assertEquals("left", m.getMediaSide());
    }

    @Test
    void configuredFully() {
        Resource r = context.create().resource("/content/test/cp",
                "sling:resourceType", "demo-ai-site/components/cta-panel",
                "eyebrow", "Explore",
                "heading", "Experience AU",
                "description", "<p>We are here to help you soar.</p>",
                "image", "/content/dam/demo-ai-site/design/experience.jpg",
                "imageAlt", "Students on campus",
                "ctaLabel", "Experience AU",
                "ctaLink", "/x",
                "secondaryCtaLabel", "AU Campus Map",
                "secondaryCtaLink", "/y",
                "style", "dual-cta",
                "mediaSide", "right");
        CtaPanelModel m = r.adaptTo(CtaPanelModel.class);
        assertNotNull(m);
        assertTrue(m.isHasContent());
        assertEquals("dual-cta", m.getStyle());
        assertEquals("right", m.getMediaSide());
        assertEquals("Experience AU", m.getHeading());
    }
}
