/*
 *  Copyright 2025 Adobe Systems Incorporated
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
class CtaBannerModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        context.create().page("/content/test");
        Resource res = context.create().resource("/content/test/jcr:content/cta",
                "sling:resourceType", "demo-ai-site/components/ctabanner");
        CtaBannerModel model = res.adaptTo(CtaBannerModel.class);
        assertNotNull(model);
        assertNull(model.getTitle());
        assertEquals("center", model.getAlignment());
        assertEquals("md", model.getSectionPadding());
        assertEquals("dark", model.getBackgroundColor());
        assertNull(model.getBackgroundStyle());
        assertFalse(model.isHasContent());
    }

    @Test
    void configuredFully() {
        context.create().page("/content/test");
        Resource res = context.create().resource("/content/test/jcr:content/cta",
                "sling:resourceType", "demo-ai-site/components/ctabanner",
                "title", "All voices are welcome here!",
                "ctaText", "Join us",
                "ctaLink", "/content/demo-ai-site/us/en/join",
                "backgroundImage", "/content/dam/demo-ai-site/design/classroom.jpg",
                "alignment", "center",
                "sectionPadding", "md",
                "backgroundColor", "other",
                "hexColor", "#3d1a0c");
        CtaBannerModel model = res.adaptTo(CtaBannerModel.class);
        assertNotNull(model);
        assertEquals("All voices are welcome here!", model.getTitle());
        assertEquals("Join us", model.getCtaText());
        assertEquals("/content/dam/demo-ai-site/design/classroom.jpg", model.getBackgroundImage());
        assertEquals("other", model.getBackgroundColor());
        assertEquals("background-color: #3d1a0c;", model.getBackgroundStyle());
        assertTrue(model.isHasContent());
    }
}
