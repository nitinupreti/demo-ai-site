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
class StatsBlockModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        context.create().page("/content/test");
        Resource res = context.create().resource("/content/test/jcr:content/stats",
                "sling:resourceType", "demo-ai-site/components/statsblock");
        StatsBlockModel model = res.adaptTo(StatsBlockModel.class);
        assertNotNull(model);
        assertNull(model.getTitle());
        assertEquals("md", model.getSectionPadding());
        assertEquals("grey", model.getBackgroundColor());
        assertNull(model.getBackgroundStyle());
        assertTrue(model.getItems().isEmpty());
        assertFalse(model.isHasContent());
    }

    @Test
    void configuredFully() {
        context.create().page("/content/test");
        Map<String, Object> props = new HashMap<>();
        props.put("sling:resourceType", "demo-ai-site/components/statsblock");
        props.put("title", "business reinvent itself");
        props.put("titlePrefix", "Helping a local");
        props.put("description", "Aliquam vitae condimentum lorem.");
        props.put("sectionPadding", "md");
        props.put("backgroundColor", "other");
        props.put("hexColor", "#f5f7fa");
        Resource res = context.create().resource("/content/test/jcr:content/stats", props);
        context.create().resource(res.getPath() + "/items");
        context.create().resource(res.getPath() + "/items/item0",
                "number", "2,245,341", "label", "Members");
        context.create().resource(res.getPath() + "/items/item1",
                "number", "46,328", "label", "Clubs");
        context.create().resource(res.getPath() + "/items/item2", "label", "No number");

        StatsBlockModel model = res.adaptTo(StatsBlockModel.class);
        assertNotNull(model);
        assertEquals("other", model.getBackgroundColor());
        assertEquals("background-color: #f5f7fa;", model.getBackgroundStyle());
        assertEquals(2, model.getItems().size());
        assertTrue(model.isHasContent());
    }
}
