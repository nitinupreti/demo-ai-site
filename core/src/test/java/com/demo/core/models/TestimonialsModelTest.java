/*
 *  Copyright 2026 Adobe Systems Incorporated
 */
package com.demo.core.models;

import java.util.HashMap;
import java.util.Map;

import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import com.demo.core.testcontext.AppAemContext;

import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@ExtendWith(AemContextExtension.class)
class TestimonialsModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource r = context.create().resource("/content/test/tst-empty",
                new HashMap<String, Object>() {{ put("sling:resourceType", "demo-ai-site/components/pos-testimonials"); }});
        TestimonialsModel m = r.adaptTo(TestimonialsModel.class);
        assertNotNull(m);
        assertFalse(m.isHasContent());
    }

    @Test
    void configuredFully() {
        Resource parent = context.create().resource("/content/test/tst-full",
                new HashMap<String, Object>() {{ put("sling:resourceType", "demo-ai-site/components/pos-testimonials"); }});
        Resource quotes = context.create().resource(parent.getPath() + "/quotes", new HashMap<>());
        Map<String, Object> q1 = new HashMap<>();
        q1.put("quote", "We have been working with Positivus for the past year.");
        q1.put("name", "John Smith");
        q1.put("title", "Marketing Director at XYZ Corp");
        context.create().resource(quotes.getPath() + "/item0", q1);

        TestimonialsModel m = parent.adaptTo(TestimonialsModel.class);
        assertNotNull(m);
        assertTrue(m.isHasContent());
        assertEquals(1, m.getQuotes().size());
        assertEquals("John Smith", m.getQuotes().get(0).getName());
    }
}
