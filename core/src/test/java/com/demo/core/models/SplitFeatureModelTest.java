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
class SplitFeatureModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        context.create().page("/content/test");
        Resource res = context.create().resource("/content/test/jcr:content/split",
                "sling:resourceType", "demo-ai-site/components/splitfeature");
        SplitFeatureModel model = res.adaptTo(SplitFeatureModel.class);
        assertNotNull(model);
        assertNull(model.getTitle());
        assertEquals("left", model.getImagePosition());
        assertEquals("md", model.getSectionPadding());
        assertEquals("white", model.getBackgroundColor());
        assertNull(model.getBackgroundStyle());
        assertFalse(model.isHasContent());
    }

    @Test
    void configuredFully() {
        context.create().page("/content/test");
        Map<String, Object> props = new HashMap<>();
        props.put("sling:resourceType", "demo-ai-site/components/splitfeature");
        props.put("title", "The unseen of spending three years at Pixelgrade");
        props.put("description", "Lorem ipsum dolor sit amet.");
        props.put("ctaText", "Learn More");
        props.put("ctaLink", "#learn");
        props.put("imagePath", "/content/dam/demo-ai-site/asset.jpg");
        props.put("imagePosition", "right");
        props.put("sectionPadding", "lg");
        props.put("backgroundColor", "other");
        props.put("hexColor", "#f5f7fa");
        Resource res = context.create().resource("/content/test/jcr:content/split", props);

        SplitFeatureModel model = res.adaptTo(SplitFeatureModel.class);
        assertNotNull(model);
        assertEquals("right", model.getImagePosition());
        assertEquals("other", model.getBackgroundColor());
        assertEquals("background-color: #f5f7fa;", model.getBackgroundStyle());
        assertTrue(model.isHasContent());
    }
}
