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
class IconCardsModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        context.create().page("/content/test");
        Resource res = context.create().resource("/content/test/jcr:content/cards",
                "sling:resourceType", "demo-ai-site/components/iconcards");
        IconCardsModel model = res.adaptTo(IconCardsModel.class);
        assertNotNull(model);
        assertNull(model.getTitle());
        assertEquals("3", model.getColumns());
        assertEquals("lg", model.getSectionPadding());
        assertEquals("white", model.getBackgroundColor());
        assertNull(model.getBackgroundStyle());
        assertTrue(model.getItems().isEmpty());
        assertFalse(model.isHasContent());
    }

    @Test
    void configuredFully() {
        context.create().page("/content/test");
        Map<String, Object> props = new HashMap<>();
        props.put("sling:resourceType", "demo-ai-site/components/iconcards");
        props.put("title", "single system");
        props.put("titlePrefix", "Manage your entire community in a");
        props.put("description", "Here's how Nexcent can help");
        props.put("columns", "3");
        props.put("sectionPadding", "lg");
        props.put("backgroundColor", "other");
        props.put("hexColor", "#f5f7fa");
        Resource res = context.create().resource("/content/test/jcr:content/cards", props);
        context.create().resource(res.getPath() + "/items");
        context.create().resource(res.getPath() + "/items/item0",
                "title", "Membership Organisations", "description", "Automation of renewals.",
                "iconPath", "/content/dam/demo-ai-site/asset.jpg");
        context.create().resource(res.getPath() + "/items/item1",
                "title", "National Associations", "description", "Full features.",
                "iconPath", "/content/dam/demo-ai-site/asset.jpg");
        // Empty item filtered
        context.create().resource(res.getPath() + "/items/item2",
                "description", "Missing title");

        IconCardsModel model = res.adaptTo(IconCardsModel.class);
        assertNotNull(model);
        assertEquals("single system", model.getTitle());
        assertEquals("other", model.getBackgroundColor());
        assertEquals("background-color: #f5f7fa;", model.getBackgroundStyle());
        assertEquals(2, model.getItems().size());
        assertTrue(model.isHasContent());
    }
}
