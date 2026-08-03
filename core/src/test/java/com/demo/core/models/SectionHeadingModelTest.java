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
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@ExtendWith(AemContextExtension.class)
class SectionHeadingModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource r = context.create().resource("/content/test/heading-empty",
                new HashMap<String, Object>() {{ put("sling:resourceType", "demo-ai-site/components/pos-section-heading"); }});
        SectionHeadingModel m = r.adaptTo(SectionHeadingModel.class);
        assertNotNull(m);
        assertNull(m.getLabel());
        assertNull(m.getSubtitle());
        assertEquals("left", m.getAlign());
        assertEquals("green", m.getLabelColor());
        assertFalse(m.isHasContent());
    }

    @Test
    void configuredFully() {
        Map<String, Object> props = new HashMap<>();
        props.put("sling:resourceType", "demo-ai-site/components/pos-section-heading");
        props.put("label", "Services");
        props.put("subtitle", "At our digital marketing agency we offer a range of services.");
        props.put("align", "center");
        props.put("labelColor", "grey");
        Resource r = context.create().resource("/content/test/heading-full", props);
        SectionHeadingModel m = r.adaptTo(SectionHeadingModel.class);
        assertNotNull(m);
        assertEquals("Services", m.getLabel());
        assertEquals("At our digital marketing agency we offer a range of services.", m.getSubtitle());
        assertEquals("center", m.getAlign());
        assertEquals("grey", m.getLabelColor());
        assertTrue(m.isHasContent());
    }
}
