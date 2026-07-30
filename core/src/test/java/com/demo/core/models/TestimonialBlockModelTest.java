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
class TestimonialBlockModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        context.create().page("/content/test");
        Resource res = context.create().resource("/content/test/jcr:content/testimonial",
                "sling:resourceType", "demo-ai-site/components/testimonialblock");
        TestimonialBlockModel model = res.adaptTo(TestimonialBlockModel.class);
        assertNotNull(model);
        assertNull(model.getQuote());
        assertEquals("md", model.getSectionPadding());
        assertEquals("white", model.getBackgroundColor());
        assertNull(model.getBackgroundStyle());
        assertTrue(model.getLogos().isEmpty());
        assertFalse(model.isHasContent());
    }

    @Test
    void configuredFully() {
        context.create().page("/content/test");
        Map<String, Object> props = new HashMap<>();
        props.put("sling:resourceType", "demo-ai-site/components/testimonialblock");
        props.put("quote", "Great experience overall.");
        props.put("authorName", "Tim Smith");
        props.put("authorRole", "British Dragon Boat Racing Association");
        props.put("imagePath", "/content/dam/demo-ai-site/asset.jpg");
        props.put("linkText", "Meet all customers");
        props.put("linkUrl", "#customers");
        props.put("backgroundColor", "other");
        props.put("hexColor", "#f5f7fa");
        Resource res = context.create().resource("/content/test/jcr:content/testimonial", props);
        context.create().resource(res.getPath() + "/logos");
        context.create().resource(res.getPath() + "/logos/logo0",
                "imagePath", "/content/dam/demo-ai-site/asset.jpg", "imageAlt", "L1");
        context.create().resource(res.getPath() + "/logos/logo1",
                "imagePath", "/content/dam/demo-ai-site/asset.jpg", "imageAlt", "L2");
        context.create().resource(res.getPath() + "/logos/logo2", "imageAlt", "Empty");

        TestimonialBlockModel model = res.adaptTo(TestimonialBlockModel.class);
        assertNotNull(model);
        assertEquals("Great experience overall.", model.getQuote());
        assertEquals("other", model.getBackgroundColor());
        assertEquals("background-color: #f5f7fa;", model.getBackgroundStyle());
        assertEquals(2, model.getLogos().size());
        assertTrue(model.isHasContent());
    }
}
