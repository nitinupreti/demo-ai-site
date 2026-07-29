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

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@ExtendWith(AemContextExtension.class)
class ResultsColumnsModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        context.create().page("/content/test");
        Resource res = context.create().resource("/content/test/jcr:content/results",
                "sling:resourceType", "demo-ai-site/components/resultscolumns");
        ResultsColumnsModel model = res.adaptTo(ResultsColumnsModel.class);
        assertNotNull(model);
        assertNull(model.getTitle());
        assertEquals("lg", model.getSectionPadding());
        assertEquals("cream", model.getBackgroundColor());
        assertNull(model.getBackgroundStyle());
        assertTrue(model.getColumns().isEmpty());
        assertFalse(model.isHasContent());
    }

    @Test
    void configuredFully() {
        context.create().page("/content/test");
        Resource res = context.create().resource("/content/test/jcr:content/results",
                "sling:resourceType", "demo-ai-site/components/resultscolumns",
                "title", "2025 Regional Results",
                "subtitle", "Scoresheets are available for download below.",
                "sectionPadding", "lg",
                "backgroundColor", "other",
                "hexColor", "#fbf9f6");
        context.create().resource(res.getPath() + "/columns");
        context.create().resource(res.getPath() + "/columns/col0",
                "columnLabel", "Speech events",
                "entries", "Dramatic Interpretation (DI)\nDuo Interpretation (DUO)\nPoetry (POE)\nHumorous Interpretation (HI)");
        context.create().resource(res.getPath() + "/columns/col1",
                "columnLabel", "Debate events",
                "entries", "Extemporaneous Debate (XDB)\nLincoln-Douglas Debate (LD)");

        ResultsColumnsModel model = res.adaptTo(ResultsColumnsModel.class);
        assertNotNull(model);
        assertEquals("2025 Regional Results", model.getTitle());
        assertEquals("other", model.getBackgroundColor());
        assertEquals("background-color: #fbf9f6;", model.getBackgroundStyle());
        assertEquals(2, model.getColumns().size());
        assertEquals("Speech events", model.getColumns().get(0).getColumnLabel());
        assertEquals(4, model.getColumns().get(0).getEntriesList().size());
        assertEquals("Poetry (POE)", model.getColumns().get(0).getEntriesList().get(2));
        assertEquals(2, model.getColumns().get(1).getEntriesList().size());
        assertTrue(model.isHasContent());
    }
}
