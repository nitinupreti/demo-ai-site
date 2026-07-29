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
class SiteFooterModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        context.create().page("/content/test");
        Resource res = context.create().resource("/content/test/jcr:content/footer",
                "sling:resourceType", "demo-ai-site/components/sitefooter");
        SiteFooterModel model = res.adaptTo(SiteFooterModel.class);
        assertNotNull(model);
        assertNull(model.getTagline());
        assertEquals("footer", model.getBackgroundColor());
        assertNull(model.getBackgroundStyle());
        assertNotNull(model.getSocialLinks());
        assertTrue(model.getSocialLinks().isEmpty());
        assertFalse(model.isHasContent());
    }

    @Test
    void configuredFully() {
        context.create().page("/content/test");
        Map<String, Object> props = new HashMap<>();
        props.put("sling:resourceType", "demo-ai-site/components/sitefooter");
        props.put("tagline", "Debate It. Don't Hate It.");
        props.put("email", "hello@figma.com");
        props.put("addressLine1", "1234 Maple Street");
        props.put("addressLine2", "Springfield, CA 90210");
        props.put("phone", "555-123-4567");
        props.put("copyright", "(c) 2025 Lincoln High");
        props.put("backgroundColor", "footer");
        Resource res = context.create().resource("/content/test/jcr:content/footer", props);
        context.create().resource(res.getPath() + "/socialLinks");
        context.create().resource(res.getPath() + "/socialLinks/item0",
                "platform", "facebook", "url", "https://facebook.com/x");
        context.create().resource(res.getPath() + "/socialLinks/item1",
                "platform", "instagram", "url", "https://instagram.com/x");
        context.create().resource(res.getPath() + "/socialLinks/item2",
                "platform", "twitter", "url", "");

        SiteFooterModel model = res.adaptTo(SiteFooterModel.class);
        assertNotNull(model);
        assertEquals("Debate It. Don't Hate It.", model.getTagline());
        assertEquals("hello@figma.com", model.getEmail());
        assertEquals(2, model.getSocialLinks().size());
        assertTrue(model.isHasContent());
    }
}
