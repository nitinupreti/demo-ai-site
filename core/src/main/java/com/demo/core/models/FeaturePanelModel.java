/*
 * Copyright 2026 Demo AI Site
 */
package com.demo.core.models;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class FeaturePanelModel {

    @ValueMapValue private String eyebrow;
    @ValueMapValue private String heading;
    @ValueMapValue private String body;
    @ValueMapValue private String backgroundImage;
    @ValueMapValue private String videoLabel;
    @ValueMapValue private String videoLink;

    public String getEyebrow() { return eyebrow; }
    public String getHeading() { return heading; }
    public String getBody() { return body; }
    public String getBackgroundImage() { return backgroundImage; }
    public String getVideoLabel() { return videoLabel; }
    public String getVideoLink() { return videoLink; }

    public String getBackgroundStyle() {
        if (StringUtils.isBlank(backgroundImage)) return null;
        return "background-image: url('" + backgroundImage.replace("'", "%27") + "');";
    }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(heading)
            || StringUtils.isNotBlank(body)
            || StringUtils.isNotBlank(backgroundImage);
    }
}
