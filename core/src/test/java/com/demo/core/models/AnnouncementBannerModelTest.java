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
class AnnouncementBannerModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        context.create().page("/content/test");
        Resource res = context.create().resource("/content/test/jcr:content/banner",
                "sling:resourceType", "demo-ai-site/components/announcementbanner");
        AnnouncementBannerModel model = res.adaptTo(AnnouncementBannerModel.class);
        assertNotNull(model);
        assertNull(model.getMessage());
        assertNull(model.getLinkText());
        assertNull(model.getLinkUrl());
        assertEquals("cream-alt", model.getBackgroundColor());
        assertNull(model.getBackgroundStyle());
        assertFalse(model.isHasContent());
    }

    @Test
    void configuredFully() {
        context.create().page("/content/test");
        Resource res = context.create().resource("/content/test/jcr:content/banner",
                "sling:resourceType", "demo-ai-site/components/announcementbanner",
                "message", "Spring election open",
                "linkText", "Survey here",
                "linkUrl", "/content/demo-ai-site/us/en/survey",
                "backgroundColor", "other",
                "hexColor", "#f6f0e4");
        AnnouncementBannerModel model = res.adaptTo(AnnouncementBannerModel.class);
        assertNotNull(model);
        assertEquals("Spring election open", model.getMessage());
        assertEquals("Survey here", model.getLinkText());
        assertEquals("/content/demo-ai-site/us/en/survey", model.getLinkUrl());
        assertEquals("other", model.getBackgroundColor());
        assertEquals("background-color: #f6f0e4;", model.getBackgroundStyle());
        assertTrue(model.isHasContent());
    }
}
