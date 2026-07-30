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

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@ExtendWith(AemContextExtension.class)
class LogoStripModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        context.create().page("/content/test");
        Resource res = context.create().resource("/content/test/jcr:content/logos",
                "sling:resourceType", "demo-ai-site/components/logostrip");
        LogoStripModel model = res.adaptTo(LogoStripModel.class);
        assertNotNull(model);
        assertNull(model.getTitle());
        assertEquals("md", model.getSectionPadding());
        assertEquals("white", model.getBackgroundColor());
        assertNull(model.getBackgroundStyle());
        assertTrue(model.getItems().isEmpty());
        assertFalse(model.isHasContent());
    }

    @Test
    void configuredFully() {
        context.create().page("/content/test");
        Map<String, Object> props = new HashMap<>();
        props.put("sling:resourceType", "demo-ai-site/components/logostrip");
        props.put("title", "Our Clients");
        props.put("description", "We have been working with some Fortune 500+ clients");
        props.put("sectionPadding", "md");
        props.put("backgroundColor", "other");
        props.put("hexColor", "#f5f7fa");
        Resource res = context.create().resource("/content/test/jcr:content/logos", props);
        context.create().resource(res.getPath() + "/items");
        context.create().resource(res.getPath() + "/items/item0",
                "imagePath", "/content/dam/demo-ai-site/asset.jpg", "imageAlt", "Client 1");
        context.create().resource(res.getPath() + "/items/item1",
                "imagePath", "/content/dam/demo-ai-site/asset.jpg", "imageAlt", "Client 2");
        // Empty entry should be filtered out
        context.create().resource(res.getPath() + "/items/item2", "imageAlt", "Missing");

        LogoStripModel model = res.adaptTo(LogoStripModel.class);
        assertNotNull(model);
        assertEquals("Our Clients", model.getTitle());
        assertEquals("other", model.getBackgroundColor());
        assertEquals("background-color: #f5f7fa;", model.getBackgroundStyle());
        assertEquals(2, model.getItems().size());
        assertTrue(model.isHasContent());
    }
}
