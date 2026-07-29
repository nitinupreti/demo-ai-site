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
class PageIntroModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        context.create().page("/content/test");
        Resource res = context.create().resource("/content/test/jcr:content/intro",
                "sling:resourceType", "demo-ai-site/components/pageintro");
        PageIntroModel model = res.adaptTo(PageIntroModel.class);
        assertNotNull(model);
        assertNull(model.getTitle());
        assertEquals("center", model.getAlignment());
        assertEquals("md", model.getSectionPadding());
        assertEquals("cream", model.getBackgroundColor());
        assertNull(model.getBackgroundStyle());
        assertFalse(model.isHasContent());
    }

    @Test
    void configuredFully() {
        context.create().page("/content/test");
        Resource res = context.create().resource("/content/test/jcr:content/intro",
                "sling:resourceType", "demo-ai-site/components/pageintro",
                "eyebrow", "Committed to all students in need",
                "title", "Lincoln High School Speech and Debate Club",
                "ctaText", "Join us",
                "ctaLink", "/content/demo-ai-site/us/en/join",
                "alignment", "center",
                "sectionPadding", "lg",
                "backgroundColor", "other",
                "hexColor", "#fbf9f6");
        PageIntroModel model = res.adaptTo(PageIntroModel.class);
        assertNotNull(model);
        assertEquals("Lincoln High School Speech and Debate Club", model.getTitle());
        assertEquals("Committed to all students in need", model.getEyebrow());
        assertEquals("Join us", model.getCtaText());
        assertEquals("/content/demo-ai-site/us/en/join", model.getCtaLink());
        assertEquals("lg", model.getSectionPadding());
        assertEquals("other", model.getBackgroundColor());
        assertEquals("background-color: #fbf9f6;", model.getBackgroundStyle());
        assertTrue(model.isHasContent());
    }
}
