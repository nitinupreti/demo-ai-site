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
class FeatureGridModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        context.create().page("/content/test");
        Resource res = context.create().resource("/content/test/jcr:content/grid",
                "sling:resourceType", "demo-ai-site/components/featuregrid");
        FeatureGridModel model = res.adaptTo(FeatureGridModel.class);
        assertNotNull(model);
        assertNull(model.getTitle());
        assertEquals("2", model.getColumns());
        assertEquals("lg", model.getSectionPadding());
        assertEquals("cream", model.getBackgroundColor());
        assertNull(model.getBackgroundStyle());
        assertTrue(model.getItems().isEmpty());
        assertFalse(model.isHasContent());
    }

    @Test
    void configuredFully() {
        context.create().page("/content/test");
        Map<String, Object> props = new HashMap<>();
        props.put("sling:resourceType", "demo-ai-site/components/featuregrid");
        props.put("title", "What We Do");
        props.put("eyebrow", "Club Details:");
        props.put("description", "Speech and Debate is where you'll learn.");
        props.put("columns", "2");
        props.put("sectionPadding", "lg");
        props.put("backgroundColor", "other");
        props.put("hexColor", "#fbf9f6");
        Resource res = context.create().resource("/content/test/jcr:content/grid", props);
        context.create().resource(res.getPath() + "/items");
        context.create().resource(res.getPath() + "/items/item0",
                "itemEyebrow", "What:", "itemTitle", "Ready to find your voice?", "itemDescription", "Safe place.");
        context.create().resource(res.getPath() + "/items/item1",
                "itemEyebrow", "Who:", "itemTitle", "All Lincoln High students", "itemDescription", "Everyone welcome.");
        // Empty item should be filtered out (no itemTitle)
        context.create().resource(res.getPath() + "/items/item2",
                "itemEyebrow", "Blank:");

        FeatureGridModel model = res.adaptTo(FeatureGridModel.class);
        assertNotNull(model);
        assertEquals("What We Do", model.getTitle());
        assertEquals("Club Details:", model.getEyebrow());
        assertEquals("2", model.getColumns());
        assertEquals("other", model.getBackgroundColor());
        assertEquals("background-color: #fbf9f6;", model.getBackgroundStyle());
        assertEquals(2, model.getItems().size(), "Empty items should be filtered");
        assertEquals("Ready to find your voice?", model.getItems().get(0).getItemTitle());
        assertTrue(model.isHasContent());
    }
}
