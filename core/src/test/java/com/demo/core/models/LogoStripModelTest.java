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
class LogoStripModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource r = context.create().resource("/content/test/logostrip-empty",
                new HashMap<String, Object>() {{ put("sling:resourceType", "demo-ai-site/components/pos-logo-strip"); }});
        LogoStripModel m = r.adaptTo(LogoStripModel.class);
        assertNotNull(m);
        assertTrue(m.getLogos().isEmpty());
        assertFalse(m.isHasContent());
        assertEquals("none", m.getTreatment());
    }

    @Test
    void configuredFully() {
        Map<String, Object> parentProps = new HashMap<>();
        parentProps.put("sling:resourceType", "demo-ai-site/components/pos-logo-strip");
        parentProps.put("treatment", "mono");
        Resource parent = context.create().resource("/content/test/logostrip-full", parentProps);
        Resource logos = context.create().resource(parent.getPath() + "/logos", new HashMap<>());
        Map<String, Object> l1 = new HashMap<>();
        l1.put("image", "/content/dam/demo-ai-site/design/amazon.png");
        l1.put("alt", "Amazon");
        context.create().resource(logos.getPath() + "/item0", l1);
        Map<String, Object> l2 = new HashMap<>();
        l2.put("image", "/content/dam/demo-ai-site/design/notion.png");
        l2.put("alt", "Notion");
        context.create().resource(logos.getPath() + "/item1", l2);

        LogoStripModel m = parent.adaptTo(LogoStripModel.class);
        assertNotNull(m);
        assertTrue(m.isHasContent());
        assertEquals(2, m.getLogos().size());
        assertEquals("Amazon", m.getLogos().get(0).getAlt());
        assertEquals("mono", m.getTreatment());
    }

    @Test
    void invalidTreatmentFallsBackToNone() {
        Map<String, Object> props = new HashMap<>();
        props.put("sling:resourceType", "demo-ai-site/components/pos-logo-strip");
        props.put("treatment", "not-a-real-value");
        Resource r = context.create().resource("/content/test/logostrip-bad", props);
        LogoStripModel m = r.adaptTo(LogoStripModel.class);
        assertNotNull(m);
        assertEquals("none", m.getTreatment());
    }
}
