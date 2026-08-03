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
class ProcessModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource r = context.create().resource("/content/test/proc-empty",
                new HashMap<String, Object>() {{ put("sling:resourceType", "demo-ai-site/components/pos-process"); }});
        ProcessModel m = r.adaptTo(ProcessModel.class);
        assertNotNull(m);
        assertFalse(m.isHasContent());
    }

    @Test
    void configuredFully() {
        Resource parent = context.create().resource("/content/test/proc-full",
                new HashMap<String, Object>() {{ put("sling:resourceType", "demo-ai-site/components/pos-process"); }});
        Resource steps = context.create().resource(parent.getPath() + "/steps", new HashMap<>());
        Map<String, Object> s1 = new HashMap<>();
        s1.put("number", "01");
        s1.put("title", "Consultation");
        s1.put("body", "During the initial consultation...");
        context.create().resource(steps.getPath() + "/item0", s1);

        ProcessModel m = parent.adaptTo(ProcessModel.class);
        assertNotNull(m);
        assertTrue(m.isHasContent());
        assertEquals(1, m.getSteps().size());
        assertEquals("Consultation", m.getSteps().get(0).getTitle());
    }
}
