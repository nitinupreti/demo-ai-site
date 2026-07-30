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
class NexcentHeroModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        context.create().page("/content/test");
        Resource res = context.create().resource("/content/test/jcr:content/hero",
                "sling:resourceType", "demo-ai-site/components/nexcenthero");
        NexcentHeroModel model = res.adaptTo(NexcentHeroModel.class);
        assertNotNull(model);
        assertNull(model.getTitlePrefix());
        assertEquals("right", model.getImagePosition());
        assertEquals("lg", model.getSectionPadding());
        assertEquals("white", model.getBackgroundColor());
        assertNull(model.getBackgroundStyle());
        assertFalse(model.isHasContent());
    }

    @Test
    void configuredFully() {
        context.create().page("/content/test");
        Map<String, Object> props = new HashMap<>();
        props.put("sling:resourceType", "demo-ai-site/components/nexcenthero");
        props.put("titlePrefix", "Lessons and insights");
        props.put("titleAccent", "from 8 years");
        props.put("description", "Where to grow your business.");
        props.put("ctaText", "Explore");
        props.put("ctaLink", "#explore");
        props.put("imagePath", "/content/dam/demo-ai-site/asset.jpg");
        props.put("imageAlt", "Illustration");
        props.put("imagePosition", "left");
        props.put("sectionPadding", "md");
        props.put("backgroundColor", "other");
        props.put("hexColor", "#f5f7fa");
        Resource res = context.create().resource("/content/test/jcr:content/hero", props);

        NexcentHeroModel model = res.adaptTo(NexcentHeroModel.class);
        assertNotNull(model);
        assertEquals("Lessons and insights", model.getTitlePrefix());
        assertEquals("from 8 years", model.getTitleAccent());
        assertEquals("left", model.getImagePosition());
        assertEquals("md", model.getSectionPadding());
        assertEquals("other", model.getBackgroundColor());
        assertEquals("background-color: #f5f7fa;", model.getBackgroundStyle());
        assertTrue(model.isHasContent());
    }
}
